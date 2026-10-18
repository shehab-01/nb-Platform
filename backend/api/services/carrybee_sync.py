"""Keeps Carrybee delivery statuses current.

Carrybee posts every status change to the store's webhook
(api.routers.webhooks), so the normal path costs no calls at all: the event
lands on the order within seconds. Webhooks can be lost, though — a deploy,
an outage, a Carrybee retry that gave up — so a slow poll backs them up:
every hour, each unsettled Carrybee parcel that nobody has heard about for
STALE_AFTER is asked about once. With webhooks working that is a handful of
calls; without them it still settles every parcel within a few hours.

Events can also arrive out of order. Each carries Carrybee's own timestamp,
kept in orders.courier_status_at, and an event older than the status the
order already has is recorded nowhere and changes nothing.

Like the Pathao poller this runs inside the API process, and a
transaction-level advisory lock lets only one worker poll at a time.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.db import async_session
from api.models import Order, OrderEvent, Store
from api.services import carrybee
from api.services.courier import CARRYBEE, CARRYBEE_SETTLED

log = logging.getLogger("carrybee_sync")

POLL_EVERY_SECONDS = 60 * 60
FIRST_POLL_DELAY_SECONDS = 120
STALE_AFTER = timedelta(hours=6)
BATCH_LIMIT = 200
BETWEEN_CALLS_SECONDS = 1.0
# Any constant, different from the Pathao poller's.
ADVISORY_LOCK_KEY = 7_420_020

# Events that only report money or bookkeeping, never where the parcel is.
# "paid" in particular comes after "delivered" and must not replace it.
NOT_A_STATUS = {"created", "create-failed", "updated", "paid"}


def apply_status(
    session: AsyncSession,
    order: Order,
    status: str | None,
    at: datetime | None,
    *,
    actor_id: int | None = None,
) -> bool:
    """Put a status Carrybee reported on the order, with an audit event when
    it changed. Returns whether it did. A status older than the one the
    order has (by Carrybee's clock) is ignored."""
    if not status:
        return False
    if at is not None and order.courier_status_at is not None and at < order.courier_status_at:
        return False
    if at is not None:
        order.courier_status_at = at
    if status == order.courier_status:
        return False
    order.courier_status = status
    session.add(
        OrderEvent(
            store_id=order.store_id,
            order_id=order.id,
            actor_id=actor_id,
            event_type="carrybee_status",
            note=status,
        )
    )
    return True


async def refresh_order(
    session: AsyncSession,
    order: Order,
    cfg: stores.CarrybeeConfig,
    actor_id: int | None = None,
) -> str | None:
    """Ask Carrybee where this parcel is and record the answer. Returns the
    status. Raises CarrybeeError when Carrybee could not be asked."""
    info = await carrybee.order_details(cfg, order.courier_consignment_id)
    order.courier_checked_at = datetime.now(timezone.utc)
    if info.delivery_fee is not None:
        order.courier_delivery_fee = info.delivery_fee
    apply_status(session, order, info.status, info.status_at, actor_id=actor_id)
    return order.courier_status


async def handle_event(session: AsyncSession, store_id: int, payload: dict[str, Any]) -> str:
    """Apply one webhook event to the store's order. Returns what happened,
    for the log. Never raises for an unknown parcel or event: Carrybee only
    needs to hear that we took it."""
    event = carrybee.normalise_status(str(payload.get("event") or ""))
    consignment_id = str(payload.get("consignment_id") or "").strip()
    if not event or not consignment_id:
        return "ignored: no event or consignment"
    order = await session.scalar(
        select(Order)
        .where(
            Order.store_id == store_id,
            Order.courier_provider == CARRYBEE,
            Order.courier_consignment_id == consignment_id,
        )
        .with_for_update(of=Order)
    )
    if order is None:
        # Booked from Carrybee's own panel, or for another of our stores.
        return f"ignored: unknown consignment {consignment_id}"
    at = carrybee.parse_time(payload.get("timestamptz"))

    if event in ("created", "updated"):
        fee = carrybee.money(payload.get("delivery_fee"))
        if fee is not None:
            order.courier_delivery_fee = fee
        return f"{event}: fee {fee}"
    if event == "paid":
        session.add(
            OrderEvent(
                store_id=order.store_id,
                order_id=order.id,
                event_type="carrybee_paid",
                note=str(payload.get("invoice_id") or "") or None,
            )
        )
        return "paid"
    if event in NOT_A_STATUS:
        return f"ignored: {event}"
    changed = apply_status(session, order, event, at)
    return f"{event}: {'applied' if changed else 'unchanged'}"


def _unsettled(store_id: int):
    return (
        Order.store_id == store_id,
        Order.courier_provider == CARRYBEE,
        Order.courier_consignment_id.is_not(None),
        or_(
            Order.courier_status.is_(None),
            func.lower(Order.courier_status).not_in(CARRYBEE_SETTLED),
        ),
    )


async def poll_once() -> int:
    """Ask about every store's Carrybee parcels that have gone quiet.
    Returns how many were asked."""
    async with async_session() as session, session.begin():
        locked = await session.scalar(select(func.pg_try_advisory_xact_lock(ADVISORY_LOCK_KEY)))
        if not locked:
            return 0
        asked = 0
        quiet_since = datetime.now(timezone.utc) - STALE_AFTER
        store_ids = (
            await session.scalars(select(Store.id).where(Store.is_active.is_(True)))
        ).all()
        for store_id in store_ids:
            integrations = await stores.load_integrations(session, store_id)
            if integrations is None or not integrations.carrybee.enabled:
                continue
            last_heard = func.greatest(
                func.coalesce(Order.courier_checked_at, Order.courier_sent_at),
                func.coalesce(Order.courier_status_at, Order.courier_sent_at),
            )
            rows = (
                await session.scalars(
                    select(Order)
                    .where(*_unsettled(store_id), or_(last_heard.is_(None), last_heard < quiet_since))
                    .order_by(last_heard.asc().nulls_first())
                    .limit(BATCH_LIMIT)
                )
            ).all()
            for order in rows:
                order.courier_checked_at = datetime.now(timezone.utc)
                try:
                    await refresh_order(session, order, integrations.carrybee)
                    asked += 1
                except carrybee.CarrybeeError as exc:
                    log.warning(
                        "Carrybee sync: %s (%s): HTTP %s %s",
                        order.courier_consignment_id,
                        order.order_no,
                        exc.status,
                        carrybee.error_text(exc),
                    )
                    if carrybee.is_rate_limited(exc):
                        return asked
                await asyncio.sleep(BETWEEN_CALLS_SECONDS)
        return asked


async def _loop() -> None:
    await asyncio.sleep(FIRST_POLL_DELAY_SECONDS)
    while True:
        try:
            asked = await poll_once()
            if asked:
                log.info("Carrybee sync: refreshed %d quiet parcels", asked)
        except Exception:  # noqa: BLE001 - the loop must survive anything
            log.exception("Carrybee sync round failed")
        await asyncio.sleep(POLL_EVERY_SECONDS)


_task: asyncio.Task | None = None


def start() -> None:
    global _task
    _task = asyncio.create_task(_loop())


async def stop() -> None:
    if _task is not None:
        _task.cancel()
