"""FraudBD: a customer's courier history and risk, by phone number.

POST https://fraudbd.com/api/check-courier-info with the store's API key and a
phone number returns, per courier, how many parcels were delivered and how
many cancelled — or, for Pathao, a customer rating instead of counts. The
answer is written to fraud_checks and pointed at from the order, so the
order lists and modals show it without asking again. A check younger than
REUSE_FOR is reused for the same store and phone.

Sandbox: FRAUDBD_SANDBOX=1 (dev) sends every call to /api/sandbox/…, where the
published sandbox key works and the data is deterministic by last digit.

Docs: https://fraudbd.com (API section).
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import FraudCheck, Order
from api.phone import phone_key

log = logging.getLogger("fraudbd")

BASE_URL = "https://fraudbd.com/api"
TIMEOUT_SECONDS = 12
REUSE_FOR = timedelta(hours=24)

# Tests inject an httpx.MockTransport here; production leaves it None.
transport: httpx.AsyncBaseTransport | None = None
_tasks: set[asyncio.Task] = set()


def sandbox() -> bool:
    return os.getenv("FRAUDBD_SANDBOX", "") == "1"


def _url() -> str:
    return f"{BASE_URL}/{'sandbox/' if sandbox() else ''}check-courier-info"


@dataclass(frozen=True)
class CourierSummary:
    name: str
    data_type: str  # "delivery" | "rating"
    total: int = 0
    success: int = 0
    cancel: int = 0
    rating: str | None = None
    risk: str | None = None
    message: str | None = None
    success_rate: float | None = None
    logo: str | None = None

    def as_json(self) -> dict:
        return {
            "name": self.name,
            "logo": self.logo,
            "data_type": self.data_type,
            "total": self.total,
            "success": self.success,
            "cancel": self.cancel,
            "rating": self.rating,
            "risk": self.risk,
            "message": self.message,
            "success_rate": self.success_rate,
        }


@dataclass(frozen=True)
class FraudResult:
    total: int = 0
    success: int = 0
    cancel: int = 0
    success_rate: Decimal | None = None
    pathao_rating: str | None = None
    pathao_risk: str | None = None
    couriers: tuple[CourierSummary, ...] = field(default_factory=tuple)
    error: str | None = None


class FraudbdError(Exception):
    """FraudBD said no, or could not be reached. `message` is safe for staff."""


def parse(body: dict) -> FraudResult:
    """The API's response body, or FraudbdError when it reports a failure."""
    if not body.get("status"):
        raise FraudbdError(str(body.get("message") or "FraudBD request failed"))
    data = body.get("data") or {}
    summaries = data.get("Summaries") or {}
    couriers: list[CourierSummary] = []
    pathao_rating = pathao_risk = None
    for name, raw in summaries.items():
        if not isinstance(raw, dict):
            continue
        data_type = str(raw.get("data_type") or "delivery")
        rate = raw.get("success_rate")
        summary = CourierSummary(
            name=str(name),
            data_type=data_type,
            total=int(raw.get("total") or 0),
            success=int(raw.get("success") or 0),
            cancel=int(raw.get("cancel") or 0),
            rating=raw.get("customer_rating"),
            risk=raw.get("risk_level"),
            message=raw.get("message"),
            success_rate=float(rate) if rate not in (None, "") else None,
            logo=str(raw["logo"]) if raw.get("logo") else None,
        )
        couriers.append(summary)
        if data_type == "rating" and name.lower() == "pathao":
            pathao_rating, pathao_risk = summary.rating, summary.risk
    totals = data.get("totalSummary") or {}
    total = int(totals.get("total") or 0)
    rate = totals.get("successRate")
    return FraudResult(
        total=total,
        success=int(totals.get("success") or 0),
        cancel=int(totals.get("cancel") or 0),
        success_rate=Decimal(str(round(float(rate), 2))) if total and rate is not None else None,
        pathao_rating=pathao_rating,
        pathao_risk=pathao_risk,
        couriers=tuple(couriers),
    )


async def lookup(phone: str, api_key: str) -> FraudResult:
    """One call to FraudBD. Raises FraudbdError on any failure."""
    if not api_key:
        raise FraudbdError("FraudBD is not configured for this store")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            res = await client.post(
                _url(),
                json={"phone_number": phone},
                headers={"api_key": api_key, "Content-Type": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise FraudbdError(f"Could not reach FraudBD: {type(exc).__name__}") from exc
    try:
        body = res.json()
    except ValueError:
        raise FraudbdError(f"FraudBD answered {res.status_code} without JSON") from None
    if not isinstance(body, dict):
        raise FraudbdError("FraudBD answered with an unexpected body")
    if res.status_code == 429:
        raise FraudbdError("FraudBD rate limit reached; try again in a minute")
    return parse(body)


def _row(store_id: int, phone: str, result: FraudResult) -> FraudCheck:
    return FraudCheck(
        store_id=store_id,
        phone_key=phone_key(phone) or phone,
        phone=phone,
        total=result.total,
        success=result.success,
        cancel=result.cancel,
        success_rate=result.success_rate,
        pathao_rating=result.pathao_rating,
        pathao_risk=result.pathao_risk,
        couriers=[c.as_json() for c in result.couriers],
        error=result.error,
    )


async def recent(session: AsyncSession, store_id: int, phone: str) -> FraudCheck | None:
    """A successful check for this store and phone younger than REUSE_FOR."""
    key = phone_key(phone) or phone
    return await session.scalar(
        select(FraudCheck)
        .where(
            FraudCheck.store_id == store_id,
            FraudCheck.phone_key == key,
            FraudCheck.error.is_(None),
            FraudCheck.checked_at >= datetime.now(timezone.utc) - REUSE_FOR,
        )
        .order_by(FraudCheck.checked_at.desc())
        .limit(1)
    )


async def check(
    session: AsyncSession, store_id: int, phone: str, api_key: str, *, force: bool = False
) -> FraudCheck:
    """The check to show for this phone: a recent one, else a fresh lookup
    written to fraud_checks. A failed lookup is written too (with `error`)
    so the UI can say why, but is never reused."""
    if not force:
        cached = await recent(session, store_id, phone)
        if cached is not None:
            return cached
    try:
        result = await lookup(phone, api_key)
    except FraudbdError as exc:
        result = FraudResult(error=str(exc))
    row = _row(store_id, phone, result)
    session.add(row)
    await session.flush()
    return row


async def _check_order(order_id: int, store_id: int, phone: str, api_key: str) -> None:
    # Imported here so the service can be unit-tested without an engine.
    from api.db import async_session

    try:
        async with async_session() as session:
            row = await check(session, store_id, phone, api_key)
            order = await session.get(Order, order_id)
            if order is not None:
                order.fraud_check_id = row.id
            await session.commit()
    except Exception:  # noqa: BLE001 — a failed check must never surface as a 500
        log.exception("FraudBD check for order %s failed", order_id)


def check_order_later(order_id: int, store_id: int, phone: str, api_key: str) -> None:
    """Run the check for a new order as its own task: the order response
    never waits on FraudBD. No key, no task."""
    if not api_key:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_check_order(order_id, store_id, phone, api_key))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
