"""Keeps Pathao delivery statuses current without anyone pressing Refresh.

Pathao offers no list of a merchant's parcels — only one status read per
consignment — so this polls: every few minutes, each booked parcel that has
not reached a final state is asked about, and the answer goes onto the order
exactly as the manual Refresh button would put it there. Staff move orders to
History before delivery is done, so the poll goes by the parcel's own state,
never by which list the order sits on.

Runs inside the API process, like the traffic-minutes flusher. With several
worker processes only one polls at a time: the batch takes a transaction-level
advisory lock, and a worker that finds it taken simply skips its turn.

Staff can also start a full sync (api.services.courier_full_sync): one pass
over every unsettled parcel of their store, with its progress recorded in
pathao_sync_runs. While one runs, the poll leaves that store alone so the two
never ask Pathao about the same parcels side by side.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.db import async_session
from api.models import Order, OrderEvent, Store
from api.services import courier_full_sync, pathao
from api.services.courier import PATHAO, PATHAO_SETTLED

log = logging.getLogger("pathao_sync")

POLL_EVERY_SECONDS = 15 * 60
# Let the service settle before the first round of outbound calls.
FIRST_POLL_DELAY_SECONDS = 60
BATCH_LIMIT = 200
# A breath between calls so a big batch never reads as a burst to Pathao.
BETWEEN_CALLS_SECONDS = 1.0
# Once Pathao starts answering 429, back off before trying that parcel again.
RATE_LIMIT_BACKOFF_SECONDS = 30
RATE_LIMIT_MAX_RETRIES = 2
# Any arbitrary constant; it only has to be the same in every worker.
ADVISORY_LOCK_KEY = 7_420_010

# Where a parcel's story ends, as Pathao spells its statuses (compared in
# lower case). Anything else is still in flight and worth asking about.
SETTLED = PATHAO_SETTLED


def is_settled(status: str | None) -> bool:
    return (status or "").lower() in SETTLED


def _unsettled(store_id: int):
    """Pathao parcels of this store that have not reached a final state.
    Carrybee's are api.services.carrybee_sync's to keep current."""
    return (
        Order.store_id == store_id,
        Order.courier_provider == PATHAO,
        Order.courier_consignment_id.is_not(None),
        or_(
            Order.courier_status.is_(None),
            func.lower(Order.courier_status).not_in(SETTLED),
        ),
    )


async def refresh_order(
    session: AsyncSession,
    order: Order,
    cfg: stores.PathaoConfig,
    actor_id: int | None = None,
) -> str | None:
    """Ask Pathao where this parcel is and record the answer on the order,
    with an audit event when it changed. Returns the status. Raises
    PathaoError when Pathao could not be asked."""
    info = await pathao.order_info(cfg, order.store_id, order.courier_consignment_id)
    status = info.raw.get("order_status_slug") or info.order_status or None
    now = datetime.now(timezone.utc)
    order.courier_checked_at = now
    if status != order.courier_status:
        order.courier_status = status
        # The answer is true as of now, so a webhook event from before it,
        # arriving late, cannot put an older status back.
        order.courier_status_at = now
        session.add(
            OrderEvent(
                store_id=order.store_id,
                order_id=order.id,
                actor_id=actor_id,
                event_type="pathao_status",
                note=status,
            )
        )
    return status


# --- Webhook ------------------------------------------------------------------

# Pathao's webhook names a status by event ("order.pickup-requested") while
# its order-info call, which the poll reads, spells it as a slug
# ("Pickup_Requested"). Events become the poll's spelling, so one order
# never carries two spellings of the same state and the Delivery filter lists
# each state once. Keys are the event with "order." removed and "-" / "_"
# unified; several spellings of one event are listed where Pathao's docs and
# panel disagree.
WEBHOOK_STATUSES = {
    "pickup-requested": "Pickup_Requested",
    "assigned-for-pickup": "Assigned_for_Pickup",
    "picked": "Picked",
    "pickup": "Picked",
    "picked-up": "Picked",
    "pickup-failed": "Pickup_Failed",
    "pickup-cancelled": "Pickup_Cancelled",
    "pickup-canceled": "Pickup_Cancelled",
    "at-the-sorting-hub": "At_the_Sorting_HUB",
    "in-transit": "In_Transit",
    "received-at-last-mile-hub": "Received_at_Last_Mile_HUB",
    "assigned-for-delivery": "Assigned_for_Delivery",
    "delivered": "Delivered",
    "partial-delivery": "Partial_Delivery",
    "return": "Return",
    "returned": "Return",
    "delivery-failed": "Delivery_Failed",
    "on-hold": "On_Hold",
    "paid-return": "Paid_Return",
    "exchange": "Exchange",
    "exchanged": "Exchange",
    "return-id-created": "Return_Id_Created",
    "return-in-transit": "Return_In_Transit",
    "returned-to-merchant": "Returned_To_Merchant",
}
# Events that report bookkeeping or money, never where the parcel is. The
# payment invoice in particular comes after "Delivered" and must not
# replace it.
NOT_A_STATUS = {"created", "updated", "paid", "payment-invoice", "invoice"}


def webhook_event(raw: str | None) -> str:
    """The event's key in WEBHOOK_STATUSES: "order.Pickup_Requested" and
    "order.pickup-requested" both become "pickup-requested"."""
    text = (raw or "").strip().lower()
    if text.startswith("order."):
        text = text[len("order."):]
    return "-".join(part for part in text.replace("_", "-").replace(" ", "-").split("-") if part)


def parse_time(raw: object) -> datetime | None:
    """The event's ISO 8601 "timestamp" with its zone, or None."""
    if not isinstance(raw, str) or not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo is not None else None


def apply_status(
    session: AsyncSession,
    order: Order,
    status: str,
    at: datetime | None,
) -> bool:
    """Put a status the webhook reported on the order, with an audit event
    when it changed. Returns whether it did. An event older than the status
    the order already has is ignored: webhooks can arrive out of order, and
    the poll stamps what it read with the time it read it."""
    now = datetime.now(timezone.utc)
    if at is not None and at > now:
        # A clock ahead of ours must not shut out every later event.
        at = now
    if at is not None and order.courier_status_at is not None and at < order.courier_status_at:
        return False
    if at is not None:
        order.courier_status_at = at
    if status.lower() == (order.courier_status or "").lower():
        # The same state, perhaps in the poll's capitalisation; keep that.
        return False
    order.courier_status = status
    session.add(
        OrderEvent(
            store_id=order.store_id,
            order_id=order.id,
            event_type="pathao_status",
            note=status,
        )
    )
    return True


async def handle_event(session: AsyncSession, store_id: int, payload: dict) -> str:
    """Apply one webhook event to the store's order. Returns what happened,
    for the log. Never raises for an unknown parcel or event: Pathao only
    needs to hear that we took it."""
    raw_event = str(payload.get("event") or "")
    consignment_id = str(payload.get("consignment_id") or "").strip()
    if not raw_event.lower().startswith("order.") or not consignment_id:
        return f"ignored: {raw_event or 'no event'}"
    event = webhook_event(raw_event)
    order = await session.scalar(
        select(Order)
        .where(
            Order.store_id == store_id,
            Order.courier_provider == PATHAO,
            Order.courier_consignment_id == consignment_id,
        )
        .with_for_update(of=Order)
    )
    if order is None:
        # Booked from Pathao's own panel, or for another of our stores.
        return f"ignored: unknown consignment {consignment_id}"
    if event in NOT_A_STATUS:
        return f"ignored: {event}"
    status = WEBHOOK_STATUSES.get(event)
    if status is None:
        # A status this code has not met. The poll will read it in Pathao's
        # own spelling; guessing one here could list the state twice.
        return f"ignored: unknown event {raw_event}"
    changed = apply_status(session, order, status, parse_time(payload.get("timestamp")))
    return f"{status}: {'applied' if changed else 'unchanged'}"


async def poll_once() -> int:
    """One round over every store's unsettled parcels, each store with its
    own credentials. Returns how many were asked."""
    async with async_session() as session, session.begin():
        locked = await session.scalar(
            select(func.pg_try_advisory_xact_lock(ADVISORY_LOCK_KEY))
        )
        if not locked:
            return 0
        asked = 0
        store_ids = (
            await session.scalars(select(Store.id).where(Store.is_active.is_(True)))
        ).all()
        for store_id in store_ids:
            if await courier_full_sync.live_run(session, store_id, PATHAO) is not None:
                # Staff are running a full sync for this store right now.
                continue
            integrations = await stores.load_integrations(session, store_id)
            if integrations is None or not integrations.pathao.enabled:
                continue
            rows = (
                await session.scalars(
                    select(Order)
                    .where(*_unsettled(store_id))
                    # Longest-unasked first. Newest-first starved everything
                    # past the first BATCH_LIMIT parcels in flight: they were
                    # never asked again and their deliveries never landed.
                    .order_by(
                        Order.courier_checked_at.asc().nulls_first(),
                        Order.courier_sent_at.desc().nulls_last(),
                    )
                    .limit(BATCH_LIMIT)
                )
            ).all()
            for order in rows:
                # Answered or not, this parcel goes to the back of the queue.
                order.courier_checked_at = datetime.now(timezone.utc)
                for attempt in range(RATE_LIMIT_MAX_RETRIES + 1):
                    try:
                        await refresh_order(session, order, integrations.pathao)
                        asked += 1
                        break
                    except pathao.PathaoError as exc:
                        if pathao.is_rate_limited(exc) and attempt < RATE_LIMIT_MAX_RETRIES:
                            log.warning(
                                "Pathao sync: rate limited, backing off %ds (%s)",
                                RATE_LIMIT_BACKOFF_SECONDS,
                                order.courier_consignment_id,
                            )
                            await asyncio.sleep(RATE_LIMIT_BACKOFF_SECONDS)
                            continue
                        # One parcel Pathao will not answer for must not stop
                        # the rest; it is asked again next round. But if it is
                        # still rate-limited after backing off, the rest of
                        # the batch would only fail the same way — stop the
                        # round early and pick it up next scheduled poll.
                        log.warning(
                            "Pathao sync: %s (%s): HTTP %s %s",
                            order.courier_consignment_id,
                            order.order_no,
                            exc.status,
                            pathao.error_text(exc),
                        )
                        if pathao.is_rate_limited(exc):
                            return asked
                        break
                await asyncio.sleep(BETWEEN_CALLS_SECONDS)
        return asked


async def _loop() -> None:
    await asyncio.sleep(FIRST_POLL_DELAY_SECONDS)
    while True:
        try:
            asked = await poll_once()
            if asked:
                log.info("Pathao sync: refreshed %d parcels", asked)
        except Exception:  # noqa: BLE001 - the loop must survive anything
            log.exception("Pathao sync round failed")
        await asyncio.sleep(POLL_EVERY_SECONDS)


_task: asyncio.Task | None = None


def start() -> None:
    global _task
    _task = asyncio.create_task(_loop())


async def stop() -> None:
    if _task is not None:
        _task.cancel()
