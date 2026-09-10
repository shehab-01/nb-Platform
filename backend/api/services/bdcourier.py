"""BDCourier: a customer's courier history and fraud reports, by phone number.

POST https://api.bdcourier.com/courier-check with the store's API key (as a
bearer token) and a phone number returns, per courier, how many parcels were
delivered and how many cancelled, plus any fraud reports filed against the
number. The answer is written to fraud_checks and pointed at from the order,
so the order lists and modals show it without asking again. A check younger
than REUSE_FOR is reused for the same store and phone.

Replaces FraudBD (fraudbd.com), which returned bad data for our numbers.
There is no sandbox mode: BDCourier meters by subscription, not by a
separate test endpoint.

Docs: https://api.bdcourier.com (Courier Check).
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import FraudCheck, Order
from api.phone import phone_key

log = logging.getLogger("bdcourier")

URL = "https://api.bdcourier.com/courier-check"
TIMEOUT_SECONDS = 12
REUSE_FOR = timedelta(hours=24)

# Tests inject an httpx.MockTransport here; production leaves it None.
transport: httpx.AsyncBaseTransport | None = None
_tasks: set[asyncio.Task] = set()


@dataclass(frozen=True)
class CourierSummary:
    name: str
    total: int = 0
    success: int = 0
    cancel: int = 0
    success_rate: float | None = None
    logo: str | None = None

    def as_json(self) -> dict:
        return {
            "name": self.name,
            "logo": self.logo,
            "total": self.total,
            "success": self.success,
            "cancel": self.cancel,
            "success_rate": self.success_rate,
        }


@dataclass(frozen=True)
class FraudReport:
    id: str
    name: str | None = None
    details: str | None = None
    created_at: str | None = None
    courier_name: str | None = None
    courier_logo: str | None = None

    def as_json(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "details": self.details,
            "created_at": self.created_at,
            "courier_name": self.courier_name,
            "courier_logo": self.courier_logo,
        }


@dataclass(frozen=True)
class FraudResult:
    total: int = 0
    success: int = 0
    cancel: int = 0
    success_rate: Decimal | None = None
    couriers: tuple[CourierSummary, ...] = field(default_factory=tuple)
    reports: tuple[FraudReport, ...] = field(default_factory=tuple)
    error: str | None = None


class BdcourierError(Exception):
    """BDCourier said no, or could not be reached. `message` is safe for staff."""


def parse(body: dict) -> FraudResult:
    """The API's response body, or BdcourierError when it reports a failure."""
    if body.get("status") != "success":
        raise BdcourierError(str(body.get("message") or "BDCourier request failed"))
    data = body.get("data") or {}
    couriers: list[CourierSummary] = []
    for name, raw in data.items():
        if name == "summary" or not isinstance(raw, dict):
            continue
        rate = raw.get("success_ratio")
        couriers.append(
            CourierSummary(
                name=str(raw.get("name") or name),
                total=int(raw.get("total_parcel") or 0),
                success=int(raw.get("success_parcel") or 0),
                cancel=int(raw.get("cancelled_parcel") or 0),
                success_rate=float(rate) if rate not in (None, "") else None,
                logo=str(raw["logo"]) if raw.get("logo") else None,
            )
        )
    summary = data.get("summary") or {}
    total = int(summary.get("total_parcel") or 0)
    rate = summary.get("success_ratio")
    reports = tuple(
        FraudReport(
            id=str(r.get("id")),
            name=r.get("name"),
            details=r.get("details"),
            created_at=r.get("created_at"),
            courier_name=r.get("courierName"),
            courier_logo=r.get("courierLogo"),
        )
        for r in (body.get("reports") or [])
        if isinstance(r, dict) and r.get("id") is not None
    )
    return FraudResult(
        total=total,
        success=int(summary.get("success_parcel") or 0),
        cancel=int(summary.get("cancelled_parcel") or 0),
        success_rate=Decimal(str(round(float(rate), 2))) if total and rate is not None else None,
        couriers=tuple(couriers),
        reports=reports,
    )


async def lookup(phone: str, api_key: str) -> FraudResult:
    """One call to BDCourier. Raises BdcourierError on any failure."""
    if not api_key:
        raise BdcourierError("BDCourier is not configured for this store")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            res = await client.post(
                URL,
                json={"phone": phone},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise BdcourierError(f"Could not reach BDCourier: {type(exc).__name__}") from exc
    try:
        body = res.json()
    except ValueError:
        raise BdcourierError(f"BDCourier answered {res.status_code} without JSON") from None
    if not isinstance(body, dict):
        raise BdcourierError("BDCourier answered with an unexpected body")
    if res.status_code == 429:
        raise BdcourierError("BDCourier rate limit reached; try again in a minute")
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
        couriers=[c.as_json() for c in result.couriers],
        reports=[r.as_json() for r in result.reports],
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
    except BdcourierError as exc:
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
        log.exception("BDCourier check for order %s failed", order_id)


def check_order_later(order_id: int, store_id: int, phone: str, api_key: str) -> None:
    """Run the check for a new order as its own task: the order response
    never waits on BDCourier. No key, no task."""
    if not api_key:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_check_order(order_id, store_id, phone, api_key))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
