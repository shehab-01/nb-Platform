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

Staff can also start a full sync (full_sync): one pass over every unsettled
parcel of their store, oldest booking first, with its progress recorded in
pathao_sync_runs. While one runs, the poll leaves that store alone so the two
never ask Pathao about the same parcels side by side.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.db import async_session
from api.models import Order, OrderEvent, PathaoSyncRun, Store
from api.services import pathao

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

# A full sync is thousands of calls in a row, so it goes a little slower than
# the poll, and waits out a 429 for longer before giving up on the run.
FULL_SYNC_BETWEEN_CALLS_SECONDS = 1.5
FULL_SYNC_BACKOFF_SECONDS = (30, 60, 120, 240)
# A running run whose heartbeat is older than this lost its worker (deploy,
# restart) and is reported as interrupted; a new one may start.
RUN_STALE_AFTER = timedelta(minutes=5)
# Enough to see a pattern without growing a row without bound.
FAILURES_KEPT = 500
# Serialises starting a run per store across workers (high bits; the store
# id fills the low 32).
START_LOCK_KEY = 7_420_011

# Where a parcel's story ends, as Pathao spells its statuses (compared in
# lower case). Anything else is still in flight and worth asking about.
SETTLED = ("delivered", "partial_delivery", "return", "paid_return", "cancelled")


def is_settled(status: str | None) -> bool:
    return (status or "").lower() in SETTLED


def _unsettled(store_id: int):
    """Booked parcels of this store that have not reached a final state."""
    return (
        Order.store_id == store_id,
        Order.pathao_consignment_id.is_not(None),
        or_(
            Order.pathao_status.is_(None),
            func.lower(Order.pathao_status).not_in(SETTLED),
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
    info = await pathao.order_info(cfg, order.store_id, order.pathao_consignment_id)
    status = info.raw.get("order_status_slug") or info.order_status or None
    order.pathao_checked_at = datetime.now(timezone.utc)
    if status != order.pathao_status:
        order.pathao_status = status
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
            if await live_run(session, store_id) is not None:
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
                        Order.pathao_checked_at.asc().nulls_first(),
                        Order.pathao_sent_at.desc().nulls_last(),
                    )
                    .limit(BATCH_LIMIT)
                )
            ).all()
            for order in rows:
                # Answered or not, this parcel goes to the back of the queue.
                order.pathao_checked_at = datetime.now(timezone.utc)
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
                                order.pathao_consignment_id,
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
                            order.pathao_consignment_id,
                            order.order_no,
                            exc.status,
                            pathao.error_text(exc),
                        )
                        if pathao.is_rate_limited(exc):
                            return asked
                        break
                await asyncio.sleep(BETWEEN_CALLS_SECONDS)
        return asked


# --- Full sync, started by staff ---------------------------------------------


def run_is_live(run: PathaoSyncRun) -> bool:
    return run.status in ("running", "stopping") and (
        run.heartbeat_at > datetime.now(timezone.utc) - RUN_STALE_AFTER
    )


def run_state(run: PathaoSyncRun) -> str:
    """The status staff see: a run whose worker died reads "interrupted"."""
    if run.status in ("running", "stopping") and not run_is_live(run):
        return "interrupted"
    return run.status


async def latest_run(session: AsyncSession, store_id: int) -> PathaoSyncRun | None:
    return await session.scalar(
        select(PathaoSyncRun)
        .where(PathaoSyncRun.store_id == store_id)
        .order_by(PathaoSyncRun.id.desc())
        .limit(1)
    )


async def live_run(session: AsyncSession, store_id: int) -> PathaoSyncRun | None:
    run = await latest_run(session, store_id)
    return run if run is not None and run_is_live(run) else None


async def start_full_sync(
    session: AsyncSession, store_id: int, actor_id: int | None
) -> PathaoSyncRun:
    """Record a new run and start it in this worker, unless one is already
    going for the store — then that one is returned. Commits."""
    # Two staff (or two workers) pressing Sync at once must not start two.
    await session.execute(
        select(func.pg_advisory_xact_lock((START_LOCK_KEY << 32) | store_id))
    )
    current = await live_run(session, store_id)
    if current is not None:
        await session.commit()
        return current
    run = PathaoSyncRun(store_id=store_id, started_by=actor_id, status="running")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    _spawn(full_sync(run.id, store_id, actor_id))
    return run


async def request_stop(session: AsyncSession, store_id: int) -> PathaoSyncRun | None:
    """Ask the live run to stop after the parcel it is on. Commits."""
    run = await live_run(session, store_id)
    if run is None:
        return None
    await session.execute(
        update(PathaoSyncRun)
        .where(PathaoSyncRun.id == run.id, PathaoSyncRun.status == "running")
        .values(status="stopping")
    )
    await session.commit()
    await session.refresh(run)
    return run


async def _finish(run_id: int, status: str, error: str | None = None) -> None:
    async with async_session() as session, session.begin():
        await session.execute(
            update(PathaoSyncRun)
            .where(PathaoSyncRun.id == run_id)
            .values(
                status=status,
                error=error,
                finished_at=func.now(),
                heartbeat_at=func.now(),
            )
        )


async def full_sync(run_id: int, store_id: int, actor_id: int | None) -> None:
    """Ask Pathao about every unsettled parcel of the store once, oldest
    booking first, one call at a time. Each parcel is committed on its own,
    so the lists show the answers as they arrive and a crash keeps them."""
    try:
        async with async_session() as session, session.begin():
            integrations = await stores.load_integrations(session, store_id)
            if integrations is None or not integrations.pathao.enabled:
                run = await session.get(PathaoSyncRun, run_id)
                run.status = "failed"
                run.error = "Pathao is not configured for this store"
                run.finished_at = datetime.now(timezone.utc)
                return
            cfg = integrations.pathao
            # Fixed at the start, so "812 of 2,000" means the same 2,000
            # throughout even as parcels settle along the way.
            order_ids = (
                await session.scalars(
                    select(Order.id)
                    .where(*_unsettled(store_id))
                    .order_by(Order.pathao_sent_at.asc().nulls_first(), Order.id)
                )
            ).all()
            run = await session.get(PathaoSyncRun, run_id)
            run.total = len(order_ids)
            run.heartbeat_at = datetime.now(timezone.utc)

        for order_id in order_ids:
            async with async_session() as session, session.begin():
                run = await session.get(PathaoSyncRun, run_id)
                if run is None or run.status != "running":
                    if run is not None and run.status == "stopping":
                        run.status = "stopped"
                        run.finished_at = datetime.now(timezone.utc)
                    return
                order = await session.get(Order, order_id)
                if order is None or not order.pathao_consignment_id:
                    run.checked += 1
                    run.heartbeat_at = datetime.now(timezone.utc)
                    continue
                before = order.pathao_status
                error: pathao.PathaoError | None = None
                for backoff in (*FULL_SYNC_BACKOFF_SECONDS, None):
                    try:
                        await refresh_order(session, order, cfg, actor_id=actor_id)
                        error = None
                        break
                    except pathao.PathaoError as exc:
                        error = exc
                        if not pathao.is_rate_limited(exc) or backoff is None:
                            break
                        log.warning(
                            "Pathao full sync: rate limited, backing off %ds (%s)",
                            backoff,
                            order.pathao_consignment_id,
                        )
                        # Keep the heartbeat fresh through a long back-off.
                        await session.execute(
                            update(PathaoSyncRun)
                            .where(PathaoSyncRun.id == run_id)
                            .values(heartbeat_at=func.now())
                        )
                        await asyncio.sleep(backoff)

                run.checked += 1
                run.heartbeat_at = datetime.now(timezone.utc)
                if error is not None:
                    order.pathao_checked_at = datetime.now(timezone.utc)
                    run.failed += 1
                    log.warning(
                        "Pathao full sync: %s (%s): HTTP %s %s",
                        order.pathao_consignment_id,
                        order.order_no,
                        error.status,
                        pathao.error_text(error),
                    )
                    if len(run.failures) < FAILURES_KEPT:
                        # A new list, so SQLAlchemy sees the JSONB change.
                        run.failures = [
                            *run.failures,
                            {
                                "order_id": order.id,
                                "consignment_id": order.pathao_consignment_id,
                                "error": pathao.error_text(error),
                            },
                        ]
                    if pathao.is_rate_limited(error):
                        run.status = "failed"
                        run.error = (
                            "Pathao kept refusing requests (too many). "
                            "Wait a while and start the sync again."
                        )
                        run.finished_at = datetime.now(timezone.utc)
                        return
                elif order.pathao_status != before:
                    run.changed += 1
                    if (order.pathao_status or "").lower() == "delivered":
                        run.delivered += 1
            await asyncio.sleep(FULL_SYNC_BETWEEN_CALLS_SECONDS)

        await _finish(run_id, "done")
    except Exception:  # noqa: BLE001 - the run must end visibly, never hang
        log.exception("Pathao full sync %s failed", run_id)
        await _finish(run_id, "failed", "The sync stopped on an unexpected error")


# Strong references so a running sync is not garbage-collected mid-way.
_runs: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _runs.add(task)
    task.add_done_callback(_runs.discard)


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
    for task in list(_runs):
        task.cancel()
