"""Staff-started full syncs: one pass over every unsettled parcel of a store
with one courier, oldest booking first, with its progress recorded in
pathao_sync_runs.

The background polls (api.services.pathao_sync, api.services.carrybee_sync)
keep statuses current on their own; this is the button staff press when they
need every number right now ("812 of 2,000"). Runs are per (store, courier):
the couriers are separate APIs, so a Pathao and a Carrybee run may go side
by side. While one runs, that courier's poll leaves the store alone so the
two never ask about the same parcels at once.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.db import async_session
from api.models import Order, PathaoSyncRun
from api.services import carrybee, pathao
from api.services.courier import CARRYBEE, LABELS, PATHAO

log = logging.getLogger("courier_full_sync")

# Thousands of calls in a row, so a little slower than the polls, and a 429
# is waited out for longer before the run gives up.
BETWEEN_CALLS_SECONDS = 1.5
BACKOFF_SECONDS = (30, 60, 120, 240)
# A running run whose heartbeat is older than this lost its worker (deploy,
# restart) and is reported as interrupted; a new one may start.
RUN_STALE_AFTER = timedelta(minutes=5)
# Enough to see a pattern without growing a row without bound.
FAILURES_KEPT = 500
# Serialises starting a run per store and courier across workers (high bits;
# the store id fills the low 32).
START_LOCK_KEYS = {PATHAO: 7_420_011, CARRYBEE: 7_420_021}


@dataclass(frozen=True)
class _Courier:
    """What a full sync needs to know about one courier."""

    config: Callable[[stores.Integrations], Any]
    refresh: Callable[..., Awaitable[str | None]]
    unsettled: Callable[[int], tuple]
    error: type[Exception]
    is_rate_limited: Callable[[Any], bool]
    error_text: Callable[[Any], str]


def _courier(provider: str) -> _Courier:
    # The pollers import this module for live_run, so theirs are imported here.
    from api.services import carrybee_sync, pathao_sync

    if provider == CARRYBEE:
        return _Courier(
            config=lambda i: i.carrybee,
            refresh=carrybee_sync.refresh_order,
            unsettled=carrybee_sync._unsettled,
            error=carrybee.CarrybeeError,
            is_rate_limited=carrybee.is_rate_limited,
            error_text=carrybee.error_text,
        )
    return _Courier(
        config=lambda i: i.pathao,
        refresh=pathao_sync.refresh_order,
        unsettled=pathao_sync._unsettled,
        error=pathao.PathaoError,
        is_rate_limited=pathao.is_rate_limited,
        error_text=pathao.error_text,
    )


def run_is_live(run: PathaoSyncRun) -> bool:
    return run.status in ("running", "stopping") and (
        run.heartbeat_at > datetime.now(timezone.utc) - RUN_STALE_AFTER
    )


def run_state(run: PathaoSyncRun) -> str:
    """The status staff see: a run whose worker died reads "interrupted"."""
    if run.status in ("running", "stopping") and not run_is_live(run):
        return "interrupted"
    return run.status


async def latest_run(
    session: AsyncSession, store_id: int, provider: str
) -> PathaoSyncRun | None:
    return await session.scalar(
        select(PathaoSyncRun)
        .where(PathaoSyncRun.store_id == store_id, PathaoSyncRun.provider == provider)
        .order_by(PathaoSyncRun.id.desc())
        .limit(1)
    )


async def live_run(
    session: AsyncSession, store_id: int, provider: str
) -> PathaoSyncRun | None:
    run = await latest_run(session, store_id, provider)
    return run if run is not None and run_is_live(run) else None


async def start_full_sync(
    session: AsyncSession, store_id: int, provider: str, actor_id: int | None
) -> PathaoSyncRun:
    """Record a new run and start it in this worker, unless one is already
    going for the store and courier — then that one is returned. Commits."""
    # Two staff (or two workers) pressing Sync at once must not start two.
    await session.execute(
        select(func.pg_advisory_xact_lock((START_LOCK_KEYS[provider] << 32) | store_id))
    )
    current = await live_run(session, store_id, provider)
    if current is not None:
        await session.commit()
        return current
    run = PathaoSyncRun(
        store_id=store_id, provider=provider, started_by=actor_id, status="running"
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    _spawn(full_sync(run.id, store_id, provider, actor_id))
    return run


async def request_stop(
    session: AsyncSession, store_id: int, provider: str
) -> PathaoSyncRun | None:
    """Ask the live run to stop after the parcel it is on. Commits."""
    run = await live_run(session, store_id, provider)
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


async def full_sync(
    run_id: int, store_id: int, provider: str, actor_id: int | None
) -> None:
    """Ask the courier about every unsettled parcel of the store once, oldest
    booking first, one call at a time. Each parcel is committed on its own,
    so the lists show the answers as they arrive and a crash keeps them."""
    courier = _courier(provider)
    label = LABELS[provider]
    try:
        async with async_session() as session, session.begin():
            integrations = await stores.load_integrations(session, store_id)
            cfg = courier.config(integrations) if integrations is not None else None
            if cfg is None or not cfg.enabled:
                run = await session.get(PathaoSyncRun, run_id)
                run.status = "failed"
                run.error = f"{label} is not configured for this store"
                run.finished_at = datetime.now(timezone.utc)
                return
            # Fixed at the start, so "812 of 2,000" means the same 2,000
            # throughout even as parcels settle along the way.
            order_ids = (
                await session.scalars(
                    select(Order.id)
                    .where(*courier.unsettled(store_id))
                    .order_by(Order.courier_sent_at.asc().nulls_first(), Order.id)
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
                if order is None or not order.courier_consignment_id:
                    run.checked += 1
                    run.heartbeat_at = datetime.now(timezone.utc)
                    continue
                before = order.courier_status
                error: Exception | None = None
                for backoff in (*BACKOFF_SECONDS, None):
                    try:
                        await courier.refresh(session, order, cfg, actor_id=actor_id)
                        error = None
                        break
                    except courier.error as exc:
                        error = exc
                        if not courier.is_rate_limited(exc) or backoff is None:
                            break
                        log.warning(
                            "%s full sync: rate limited, backing off %ds (%s)",
                            label,
                            backoff,
                            order.courier_consignment_id,
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
                    order.courier_checked_at = datetime.now(timezone.utc)
                    run.failed += 1
                    log.warning(
                        "%s full sync: %s (%s): HTTP %s %s",
                        label,
                        order.courier_consignment_id,
                        order.order_no,
                        getattr(error, "status", None),
                        courier.error_text(error),
                    )
                    if len(run.failures) < FAILURES_KEPT:
                        # A new list, so SQLAlchemy sees the JSONB change.
                        run.failures = [
                            *run.failures,
                            {
                                "order_id": order.id,
                                "consignment_id": order.courier_consignment_id,
                                "error": courier.error_text(error),
                            },
                        ]
                    if courier.is_rate_limited(error):
                        run.status = "failed"
                        run.error = (
                            f"{label} kept refusing requests (too many). "
                            "Wait a while and start the sync again."
                        )
                        run.finished_at = datetime.now(timezone.utc)
                        return
                elif order.courier_status != before:
                    run.changed += 1
                    if (order.courier_status or "").lower() == "delivered":
                        run.delivered += 1
            await asyncio.sleep(BETWEEN_CALLS_SECONDS)

        await _finish(run_id, "done")
    except Exception:  # noqa: BLE001 - the run must end visibly, never hang
        log.exception("%s full sync %s failed", label, run_id)
        await _finish(run_id, "failed", "The sync stopped on an unexpected error")


# Strong references so a running sync is not garbage-collected mid-way.
_runs: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _runs.add(task)
    task.add_done_callback(_runs.discard)


async def stop() -> None:
    for task in list(_runs):
        task.cancel()
