"""
Who visits the storefront, and how many of them buy.

Every storefront page load posts a PageView report to /api/track (for the
Conversions API twin). Each one is also written here as a visit, keyed by a
hash of the browser's _fbp cookie — a cookie we set ourselves, stable for the
life of the browser profile — so "visitors" means distinct browsers, not
requests. Without the cookie the address and user agent stand in, which
undercounts a shared CGNAT address but never overcounts.

The System page reads the summary: page views, visitors, web orders and the
conversion rate (orders per visitor) for today, the last 7 and the last 30
days, in the shop's Dhaka days.

Recording is fire-and-forget on its own task, like a CAPI delivery: a page
view must never slow down or fail the request that reported it.
"""
import asyncio
import hashlib
import logging
from datetime import datetime, time, timedelta, timezone
from urllib.parse import urlparse

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import async_session
from api.models import Order, OrderSource, OrderStatus, Visit
from api.ratelimit import client_ip

log = logging.getLogger("visits")

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")
# Long enough for a year-on-year look; the rows are tiny.
RETAIN_DAYS = 400

_tasks: set[asyncio.Task] = set()


def visitor_key(fbp: str | None, ip: str | None, user_agent: str | None) -> str:
    """A 32-hex-char hash naming the browser, never the person."""
    raw = f"fbp:{fbp}" if fbp else f"ua:{ip or ''}|{user_agent or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _path(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return urlparse(url).path[:255] or "/"
    except ValueError:
        return None


async def _insert(store_id: int, visitor: str, path: str | None) -> None:
    try:
        async with async_session() as session:
            session.add(Visit(store_id=store_id, visitor=visitor, path=path))
            await session.commit()
    except Exception as exc:  # noqa: BLE001 — a lost visit is not worth a 500
        log.warning("visit not recorded: %s", exc)


def record(
    request: Request, *, store_id: int, source_url: str | None, fbp_fallback: str | None
) -> None:
    """Note a storefront page view for this store. Returns at once."""
    fbp = request.cookies.get("_fbp") or fbp_fallback
    visitor = visitor_key(fbp, client_ip(request), request.headers.get("user-agent"))
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_insert(store_id, visitor, _path(source_url)))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def prune() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)
    async with async_session() as session:
        await session.execute(delete(Visit).where(Visit.at < cutoff))
        await session.commit()


def _periods(now: datetime) -> list[tuple[str, str, datetime]]:
    today = datetime.combine(now.astimezone(DHAKA).date(), time.min, tzinfo=DHAKA)
    return [
        ("today", "Today", today),
        ("last_7d", "Last 7 days", today - timedelta(days=6)),
        ("last_30d", "Last 30 days", today - timedelta(days=29)),
    ]


# A sale from the site — not a staff-typed order, not an abandoned form.
_WEB_ORDER = (
    Order.source == OrderSource.website.value,
    Order.status != OrderStatus.incomplete.value,
)


async def summary(
    session: AsyncSession, store_id: int | None = None, now: datetime | None = None
) -> dict:
    """Visitors, page views, web orders and conversion per period, for one
    store or (store_id None) the whole platform."""
    now = now or datetime.now(timezone.utc)
    scope_v = [Visit.store_id == store_id] if store_id is not None else []
    scope_o = [Order.store_id == store_id] if store_id is not None else []
    first = await session.scalar(select(func.min(Visit.at)).where(*scope_v))
    periods = []
    for key, label, start in _periods(now):
        page_views, visitors = (
            await session.execute(
                select(func.count(), func.count(func.distinct(Visit.visitor))).where(
                    *scope_v, Visit.at >= start
                )
            )
        ).one()
        # Orders only from when visit counting began, so a window that reaches
        # back before the first visit does not show a conversion rate against
        # visitors who were never counted.
        orders_since = max(start, first) if first else start
        orders = await session.scalar(
            select(func.count())
            .select_from(Order)
            .where(*scope_o, *_WEB_ORDER, Order.created_at >= orders_since)
        )
        visitors = int(visitors or 0)
        orders = int(orders or 0)
        periods.append(
            {
                "key": key,
                "label": label,
                "since": start.isoformat(),
                "page_views": int(page_views or 0),
                "visitors": visitors,
                "orders": orders,
                # Orders per hundred visitors; null when nobody came.
                "conversion_pct": round(orders * 100 / visitors, 1) if visitors else None,
            }
        )
    return {
        "periods": periods,
        # When counting began, so a fresh deployment's low numbers read as
        # "since Tuesday", not "nobody comes here".
        "since": first.isoformat() if first else None,
        "retain_days": RETAIN_DAYS,
    }
