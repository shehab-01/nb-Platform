import os
import platform
import shutil
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api import monitoring, stores, tenancy, visits
from api.auth import require_super_admin
from api.config import settings
from api.db import engine, get_session
from api.models import MetaCapiFailedEvent, Order, OrderEvent, TrafficMinute, User, UserStatus
from api.ratelimit import client_ip, drafts_limiter, logins_limiter, orders_limiter
from api.routers.track import track_limiter
from api.schemas import CapiFailedEventOut, CapiResendIn, PathaoStatusOut
from api.services import meta_capi, pathao

router = APIRouter(
    prefix="/system",
    tags=["System"],
    dependencies=[Depends(require_super_admin)],
)

# Headers that say where a request came from and what it passed through. The
# configured client-address header goes first so it is always listed, whatever
# proxy sits in front (see CLIENT_IP_HEADER).
FORWARDING_HEADERS = tuple(
    header
    for header in dict.fromkeys(
        (
            settings.client_ip_header.lower(),
            "cf-connecting-ip",
            "cf-ray",
            "cf-ipcountry",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "x-real-ip",
            "user-agent",
        )
    )
    if header
)

TRAFFIC_COLUMNS = (
    "requests",
    "throttled",
    "cooldown",
    "client_errors",
    "server_errors",
    "latency_ms",
)


@router.get("/request-info")
async def request_info(request: Request) -> dict:
    """
    What the API sees of the caller's own request: the socket address, the
    address the rate limiter would key on, and the forwarding headers that
    survived the proxies in between. For checking that the proxy's client
    address header (CLIENT_IP_HEADER) really reaches this container — if it
    doesn't, per-IP limiting is silently off.
    """
    return {
        "socket_client": request.client.host if request.client else None,
        "resolved_client_ip": client_ip(request),
        "headers": {
            name: request.headers.get(name) for name in FORWARDING_HEADERS
        },
    }


def _meminfo() -> dict[str, int]:
    """MemTotal / MemAvailable in bytes. /proc is the host kernel's, so this
    is the whole machine, not just this container."""
    wanted = {"MemTotal", "MemAvailable"}
    out: dict[str, int] = {}
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                if key in wanted:
                    out[key] = int(rest.split()[0]) * 1024
    except OSError:
        pass
    return out


def _totals(row) -> dict:
    values = {col: int(getattr(row, col) or 0) for col in TRAFFIC_COLUMNS}
    values["avg_latency_ms"] = (
        round(values["latency_ms"] / values["requests"], 1) if values["requests"] else 0
    )
    return values


def _selected_store_id(request: Request) -> int | None:
    """The store the admin has selected (X-Admin-Store), when any. The System
    page is platform-wide, so this only narrows the per-store figures."""
    raw = request.headers.get(tenancy.ADMIN_STORE_HEADER, "").strip()
    return int(raw) if raw.isdigit() else None


@router.get("/overview")
async def overview(
    request: Request, session: AsyncSession = Depends(get_session)
) -> dict:
    """Everything the System page shows, in one round trip. Traffic and host
    figures are the whole service; visitors, orders and integration flags are
    the selected store's."""
    now = datetime.now(timezone.utc)
    store_id = _selected_store_id(request)
    integrations = (
        await stores.load_integrations(session, store_id) if store_id is not None else None
    )

    # -- database ------------------------------------------------------------
    started = time.perf_counter()
    await session.execute(text("SELECT 1"))
    db_latency_ms = round((time.perf_counter() - started) * 1000, 2)
    db_size = await session.scalar(text("SELECT pg_database_size(current_database())"))
    pg_version = await session.scalar(text("SHOW server_version"))
    pool = engine.pool

    # -- traffic: last 60 minutes per minute, summed across workers ---------
    sums = [func.sum(getattr(TrafficMinute, col)).label(col) for col in TRAFFIC_COLUMNS]
    window_start = now.replace(second=0, microsecond=0) - timedelta(minutes=59)
    rows = await session.execute(
        select(TrafficMinute.minute, *sums)
        .where(TrafficMinute.minute >= window_start)
        .group_by(TrafficMinute.minute)
    )
    by_minute = {row.minute: row for row in rows}
    per_minute = []
    for i in range(60):
        minute = window_start + timedelta(minutes=i)
        row = by_minute.get(minute)
        point = {"minute": minute.isoformat()}
        point.update(
            {col: int(getattr(row, col) or 0) if row else 0 for col in TRAFFIC_COLUMNS}
        )
        per_minute.append(point)

    class _Sum:
        pass

    hour = _Sum()
    for col in TRAFFIC_COLUMNS:
        setattr(hour, col, sum(p[col] for p in per_minute))
    day = (
        await session.execute(
            select(*sums).where(TrafficMinute.minute >= now - timedelta(hours=24))
        )
    ).one()

    # -- orders, from the audit trail so promoted drafts count once --------
    async def events(kinds: tuple[str, ...], since: datetime, new_status: str | None = None) -> int:
        conditions = [*scope_events, OrderEvent.event_type.in_(kinds), OrderEvent.created_at >= since]
        if new_status:
            conditions.append(OrderEvent.new_status == new_status)
        return int(await session.scalar(select(func.count()).select_from(OrderEvent).where(*conditions)) or 0)

    scope_events = [OrderEvent.store_id == store_id] if store_id is not None else []
    scope_orders = [Order.store_id == store_id] if store_id is not None else []
    flow = {}
    for name, since in (("last_hour", now - timedelta(hours=1)), ("last_24h", now - timedelta(hours=24))):
        flow[name] = {
            "orders_placed": await events(("created", "draft_submitted"), since),
            "forms_captured": await events(("draft_captured",), since),
            "confirmed": await events(("status_changed",), since, "confirmed"),
            "cancelled": await events(("status_changed",), since, "cancelled"),
        }
    by_status = {
        status: int(count)
        for status, count in await session.execute(
            select(Order.status, func.count()).where(*scope_orders).group_by(Order.status)
        )
    }
    pending_signins = int(
        await session.scalar(
            select(func.count()).select_from(User).where(User.status == UserStatus.pending)
        )
        or 0
    )

    # -- this request: is the client address visible to the limiter? --------
    ip = client_ip(request)

    # -- host ---------------------------------------------------------------
    load1, load5, load15 = os.getloadavg()
    mem = _meminfo()
    disk = shutil.disk_usage("/")

    return {
        "generated_at": now.isoformat(),
        "database": {
            "ok": True,
            "latency_ms": db_latency_ms,
            "size_bytes": int(db_size or 0),
            "version": pg_version,
            "pool": {
                "size": pool.size(),
                "in_use": pool.checkedout(),
                "overflow": max(0, pool.overflow()),
                "max_overflow": settings.db_max_overflow,
            },
        },
        "traffic": {
            "per_minute": per_minute,
            "last_hour": _totals(hour),
            "last_24h": _totals(day),
            "flush_every_seconds": monitoring.FLUSH_EVERY_SECONDS,
        },
        "visitors": await visits.summary(session, store_id),
        "store_id": store_id,
        "orders": {
            "flow": flow,
            "by_status": by_status,
            "total": sum(by_status.values()),
            "pending_signins": pending_signins,
        },
        "rate_limits": {
            "limiters": [
                limiter.snapshot()
                for limiter in (orders_limiter, drafts_limiter, logins_limiter, track_limiter)
            ],
            "order_cooldown_hours": settings.order_cooldown_hours,
            "client_ip_header": settings.client_ip_header,
        },
        "request": {
            "client_ip": ip,
            "client_ip_visible": ip is not None,
            # Which header the address was read from, and whether it arrived.
            "client_ip_header": settings.client_ip_header,
            "client_ip_header_present": bool(
                settings.client_ip_header
                and request.headers.get(settings.client_ip_header)
            ),
            "via_cloudflare": bool(request.headers.get("cf-ray")),
            "country": request.headers.get("cf-ipcountry"),
        },
        "server": {
            "load": [round(load1, 2), round(load5, 2), round(load15, 2)],
            "cpus": os.cpu_count() or 1,
            "memory_total": mem.get("MemTotal"),
            "memory_available": mem.get("MemAvailable"),
            "disk_total": disk.total,
            "disk_free": disk.free,
        },
        "process": {
            "worker": monitoring.WORKER_ID,
            "started_at": monitoring.STARTED_AT.isoformat(),
            "uptime_seconds": int((now - monitoring.STARTED_AT).total_seconds()),
            "workers_configured": int(os.getenv("UVICORN_WORKERS", "2")),
            "python": platform.python_version(),
        },
        "integrations": {
            # The browser pixel needs only the ID; server-side CAPI needs the
            # access token as well. Reported apart so "no token yet" doesn't
            # read as "pixel off".
            "meta_pixel": bool(integrations and integrations.meta.pixel_id),
            "meta_capi": bool(integrations and integrations.meta.enabled),
            "meta_test_mode": bool(integrations and integrations.meta.test_event_code),
            # Events Meta never accepted, parked for a resend (all workers),
            # and deliveries this worker still has in flight.
            "meta_capi_failed": await meta_capi.failed_count(session, store_id),
            "meta_capi_pending": meta_capi.pending(),
            "google_login": bool(settings.google_client_id),
            "secure_cookies": settings.cookie_secure,
        },
        "recent_logs": list(monitoring.recent_logs.records)[::-1][:100],
    }


@router.get("/pathao", response_model=PathaoStatusOut)
async def pathao_status(
    request: Request, session: AsyncSession = Depends(get_session)
) -> PathaoStatusOut:
    """
    Is Pathao configured for the selected store, which environment, and which
    merchant stores the credentials can see — the check to run once after
    entering keys in Settings, so the Pathao store id can be copied from here
    rather than guessed.
    """
    store_id = _selected_store_id(request)
    integrations = (
        await stores.load_integrations(session, store_id) if store_id is not None else None
    )
    cfg = integrations.pathao if integrations else stores.PathaoConfig()
    out = PathaoStatusOut(
        enabled=cfg.enabled,
        sandbox=pathao.is_sandbox(),
        base_url=settings.pathao_base_url,
        store_id=cfg.store_id,
        unit_weight_kg=cfg.unit_weight_kg,
    )
    if store_id is None:
        out.error = "Select a store in the switcher"
        return out
    if not out.enabled:
        out.error = "Pathao is not configured in this store's Settings"
        return out
    try:
        out.stores = await pathao.list_stores(cfg, store_id)
    except pathao.PathaoError as exc:
        out.error = pathao.error_text(exc)
    return out


# --- Meta Conversions API: parked events -------------------------------------


@router.get("/capi/failed", response_model=list[CapiFailedEventOut])
async def capi_failed(
    session: AsyncSession = Depends(get_session),
) -> list[MetaCapiFailedEvent]:
    """
    Events Meta never accepted, oldest first: every retry timed out or failed,
    or the request was rejected (bad token, malformed payload). The payload is
    kept whole so a resend is the same event, same event_id, same event_time.
    """
    rows = await session.scalars(
        select(MetaCapiFailedEvent).order_by(MetaCapiFailedEvent.id).limit(200)
    )
    return list(rows.all())


@router.post("/capi/failed/resend")
async def capi_resend(
    payload: CapiResendIn | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:  # noqa: D401
    """
    Try the parked events again, one attempt each. Delivered rows disappear;
    the rest keep the new error. Meta accepts website events up to seven days
    old, so anything older than that will keep failing and should be deleted.
    """
    async def meta_for(store_id: int) -> stores.MetaConfig | None:
        integrations = await stores.load_integrations(session, store_id)
        return integrations.meta if integrations else None

    return await meta_capi.resend_failed(
        session, meta_for, ids=payload.ids if payload else None
    )


@router.delete("/capi/failed/{event_id}", status_code=204)
async def capi_delete_failed(
    event_id: int, session: AsyncSession = Depends(get_session)
) -> None:
    """Drop a parked event that can never be delivered (too old, bad payload)."""
    row = await session.get(MetaCapiFailedEvent, event_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No such parked event")
    await session.delete(row)
    await session.commit()
