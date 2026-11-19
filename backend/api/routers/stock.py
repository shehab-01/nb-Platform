"""Stock: how many packets the store has, for stores with stock_enabled.

The ledger is api.services.stock: production slots received add packets,
orders moved to History take them (each line × its option's packets),
courier returns put them back, and an admin's correction moves them either
way. This page reads it a month at a time — the month's days in figures and
the movements people typed or received — and is where returns and
corrections are entered.

Who may do what: anyone on the store's Production pages
(tenancy.require_production) reads stock and enters a return dated today.
Production admins also back-date returns, type corrections, delete a return
or a correction entered by mistake, and run Sync, which fills the ledger
from the slots and History already there (stock switched on for a store
that has been selling for a while) and repairs any drift. Stock may go
below zero — dispatch is never held up by it — and the page warns instead.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import tenancy
from api.db import get_session
from api.models import Product, ProductionRun, ProductionSlot, ProductVariant, StockMovement
from api.schemas import (
    StockAdjustIn,
    StockDayOut,
    StockEntryOut,
    StockOptionOut,
    StockOut,
    StockReturnIn,
    StockSyncOut,
)
from api.services import stock

router = APIRouter(prefix="/stock", tags=["Stock"])


def _keeps_stock(ctx: tenancy.StoreContext) -> tenancy.StoreContext:
    if not ctx.store.stock_enabled:
        raise HTTPException(status_code=409, detail="This store does not keep stock")
    return ctx


async def _require(
    ctx: tenancy.StoreContext = Depends(tenancy.require_production),
) -> tenancy.StoreContext:
    return _keeps_stock(ctx)


async def _admin(
    ctx: tenancy.StoreContext = Depends(tenancy.require_production_admin),
) -> tenancy.StoreContext:
    return _keeps_stock(ctx)


def month_bounds(month: str) -> tuple[date, date]:
    """"2026-11" -> (1 Nov 2026, 1 Dec 2026), the end exclusive."""
    try:
        year, number = (int(part) for part in month.split("-"))
        start = date(year, number, 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    end = date(year + 1, 1, 1) if number == 12 else date(year, number + 1, 1)
    return start, end


def _check_day(day: date | None, ctx: tenancy.StoreContext) -> date:
    today = stock.today()
    if day is None:
        return today
    if day > today:
        raise HTTPException(status_code=400, detail="That day has not happened yet")
    if day != today and not tenancy.is_production_admin(ctx.user):
        raise HTTPException(
            status_code=403, detail="Only a production admin can enter stock on another day"
        )
    return day


async def _options(session: AsyncSession, store_id: int) -> list[StockOptionOut]:
    rows = await session.execute(
        select(Product.title, Product.is_active, ProductVariant)
        .join(ProductVariant, ProductVariant.product_id == Product.id)
        .where(Product.store_id == store_id)
        .order_by(Product.is_active.desc(), Product.id, ProductVariant.stock_packets, ProductVariant.id)
    )
    return [
        StockOptionOut(
            variant_id=v.id,
            name=f"{title} — {v.label}" if v.label else title,
            stock_packets=v.stock_packets,
            is_active=active,
        )
        for title, active, v in rows.all()
    ]


@router.get("", response_model=StockOut)
async def read_stock(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> StockOut:
    """Stock in hand now, and one month of it: the stock it opened with,
    each day that moved, and the slots, returns and corrections in it."""
    store_id = ctx.store.id
    start, end = month_bounds(month or stock.today().strftime("%Y-%m"))
    opening = await stock.on_hand(session, store_id, before=start)
    moves = (
        await session.execute(
            select(StockMovement.on_day, StockMovement.kind, StockMovement.packets).where(
                StockMovement.store_id == store_id,
                StockMovement.on_day >= start,
                StockMovement.on_day < end,
            )
        )
    ).all()
    days = stock.day_rows(opening, [tuple(m) for m in moves])
    entries = (
        await session.execute(
            select(StockMovement, ProductionSlot.number, ProductionRun.id, ProductionRun.name)
            .outerjoin(ProductionSlot, ProductionSlot.id == StockMovement.slot_id)
            .outerjoin(ProductionRun, ProductionRun.id == ProductionSlot.run_id)
            .where(
                StockMovement.store_id == store_id,
                StockMovement.kind != stock.SALE,
                StockMovement.on_day >= start,
                StockMovement.on_day < end,
            )
            .order_by(StockMovement.on_day.desc(), StockMovement.id.desc())
        )
    ).all()
    received = sum(d.received for d in days)
    sent = sum(d.sent for d in days)
    returned = sum(d.returned for d in days)
    adjusted = sum(d.adjusted for d in days)
    return StockOut(
        on_hand=await stock.on_hand(session, store_id),
        month=start.strftime("%Y-%m"),
        opening=opening,
        received=received,
        sent=sent,
        returned=returned,
        adjusted=adjusted,
        closing=opening + received - sent + returned + adjusted,
        days=[StockDayOut(**vars(d)) for d in reversed(days)],
        entries=[
            StockEntryOut(
                id=m.id,
                kind=m.kind,
                on_day=m.on_day,
                packets=m.packets,
                note=m.note,
                variant_name=m.variant_name,
                combos=m.combos,
                run_id=run_id,
                run_name=run_name,
                slot_number=number,
                created_by=m.created_by.display_name if m.created_by else None,
                created_at=m.created_at,
            )
            for m, number, run_id, run_name in entries
        ],
        options=await _options(session, store_id),
    )


@router.post("/returns", status_code=201)
async def add_return(
    body: StockReturnIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> dict:
    """So many of one option came back from the courier: that many × its
    packets go back into stock."""
    store_id = ctx.store.id
    on_day = _check_day(body.on_day, ctx)
    option = next(
        (o for o in await _options(session, store_id) if o.variant_id == body.variant_id), None
    )
    if option is None:
        raise HTTPException(status_code=404, detail="No such option in this store")
    session.add(
        StockMovement(
            store_id=store_id,
            kind=stock.RETURN,
            on_day=on_day,
            packets=body.combos * option.stock_packets,
            variant_id=option.variant_id,
            variant_name=option.name,
            combos=body.combos,
            note=(body.note or "").strip() or None,
            created_by_id=ctx.user.id,
        )
    )
    await session.commit()
    return {"on_hand": await stock.on_hand(session, store_id)}


@router.post("/adjustments", status_code=201)
async def add_adjustment(
    body: StockAdjustIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_admin),
) -> dict:
    """A correction with its reason (production admins only)."""
    store_id = ctx.store.id
    session.add(
        StockMovement(
            store_id=store_id,
            kind=stock.ADJUST,
            on_day=_check_day(body.on_day, ctx),
            packets=body.packets,
            note=body.note,
            created_by_id=ctx.user.id,
        )
    )
    await session.commit()
    return {"on_hand": await stock.on_hand(session, store_id)}


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_admin),
) -> None:
    """Remove a return or a correction entered by mistake (production admins
    only). Slot and sale rows follow their slot and order, so they cannot be
    deleted here."""
    row = await session.scalar(
        select(StockMovement).where(
            StockMovement.id == entry_id, StockMovement.store_id == ctx.store.id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No such entry")
    if row.kind not in (stock.RETURN, stock.ADJUST):
        raise HTTPException(
            status_code=409,
            detail="This entry follows its slot or order; change that instead",
        )
    await session.delete(row)
    await session.commit()


@router.post("/sync", response_model=StockSyncOut)
async def sync_stock(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_admin),
) -> StockSyncOut:
    """Fill the ledger from every slot received and every order in History,
    and repair what has drifted (production admins only). Safe to repeat."""
    store_id = ctx.store.id
    result = await stock.sync(session, store_id, ctx.user.id)
    try:
        await session.commit()
    except IntegrityError:
        # An order went to History, or a slot arrived, while this ran.
        await session.rollback()
        raise HTTPException(status_code=409, detail="Stock changed while syncing; run it again")
    return StockSyncOut(**vars(result), on_hand=await stock.on_hand(session, store_id))
