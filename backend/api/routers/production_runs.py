"""Batch production: an order of so many packets, received in slots.

For stores whose production_mode is "batch" (Eco-Tine). Someone opens a
production for, say, 12,000 packets and records what was bought for the
whole order: the raw material (so many kg for so much) and lines such as
the packets themselves, combo boxes, paper, labels and glue, each quantity ×
unit price. The finished packets then come back in slots over the following
days. Each slot is received on its own date, with its own costs (labour per
1,000 pieces, packet making per packet, transport…), and prints as an
invoice. Received is the slots' packets, pending is what is left of the
order, and the production is closed once nothing is pending. Only a super
admin may close it early, with packets still pending.

Every amount and figure is worked out here from what was typed (rates and
unit prices keep their paisa, amounts are whole taka rounded half up), never
taken from the browser. Cost per packet is the whole cost over the packets
received. The raw material counts in full, whatever is recorded as used on
closing.

Who may do what: anyone on the store's Production pages
(tenancy.require_production) opens productions dated today, fills in and
corrects open ones (quantities are often known only later), and records
slots. Production admins also back-date, re-date, and delete slots. The CRM
admins delete a whole production. Only a super admin closes early or
reopens a closed production. A closed production is read only.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import tenancy
from api.db import get_session
from api.models import ProductionRun, ProductionRunCost, ProductionSlot, ProductionSlotCost
from api.schemas import (
    ProductionRunCloseIn,
    ProductionRunCostIn,
    ProductionRunCostOut,
    ProductionRunDefaults,
    ProductionRunIn,
    ProductionRunOut,
    ProductionRunSummary,
    ProductionSlotCostIn,
    ProductionSlotCostOut,
    ProductionSlotIn,
    ProductionSlotOut,
)
from api.services import production_invoice, production_report, stock

router = APIRouter(prefix="/production/runs", tags=["Production (batch)"])

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")
BATCH = "batch"

# What the very first production of a store starts from. The packets follow
# the order's units; every other quantity is filled in once known. No prices:
# the first production sets them, and each later one starts from the last.
DEFAULT_COSTS: tuple[ProductionRunCostOut, ...] = (
    ProductionRunCostOut(item="Packet", unit="packet", follows_units=True, amount=0),
    ProductionRunCostOut(item="3-packet combo box", unit="pcs", amount=0),
    ProductionRunCostOut(item="5-packet combo box", unit="pcs", amount=0),
    ProductionRunCostOut(item="Cigarette paper", unit="ream", amount=0),
    ProductionRunCostOut(item="Cigarette label", unit="kg", amount=0),
    ProductionRunCostOut(item="Glue", unit="pcs", amount=0),
)
DEFAULT_SLOT_COSTS: tuple[ProductionSlotCostOut, ...] = (
    ProductionSlotCostOut(label="Labour charge", basis="per_1000_pieces", rate=400, amount=0),
    ProductionSlotCostOut(label="Packet production", basis="per_packet", rate=4, amount=0),
    ProductionSlotCostOut(label="Transport", basis="fixed", amount=0),
    ProductionSlotCostOut(label="Others", basis="fixed", amount=0),
)
DEFAULT_PIECES_PER_PACKET = 20


def _today() -> date:
    return datetime.now(DHAKA).date()


# --- Access ----------------------------------------------------------------------


def _only_batch(ctx: tenancy.StoreContext) -> tenancy.StoreContext:
    if ctx.store.production_mode != BATCH:
        raise HTTPException(
            status_code=409, detail="This store records production by day, not in batches"
        )
    return ctx


async def _require(
    ctx: tenancy.StoreContext = Depends(tenancy.require_production),
) -> tenancy.StoreContext:
    return _only_batch(ctx)


async def _admin(
    ctx: tenancy.StoreContext = Depends(tenancy.require_production_admin),
) -> tenancy.StoreContext:
    return _only_batch(ctx)


async def _crm_admin(
    ctx: tenancy.StoreContext = Depends(tenancy.require_crm_admin),
) -> tenancy.StoreContext:
    return _only_batch(ctx)


# --- Figures (pure) --------------------------------------------------------------


def whole(x: Decimal) -> int:
    """Whole taka, half up: ৳112.5 is ৳113."""
    return int(x.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def cost_amount(quantity: Decimal | None, unit_price: Decimal | None) -> int:
    """A line bought for the order: quantity × unit price, or nothing while
    either is blank."""
    if quantity is None or unit_price is None:
        return 0
    return whole(quantity * unit_price)


def slot_cost_amount(
    basis: str, rate: Decimal | None, amount: int | None, packets: int, pieces_per_packet: int
) -> int:
    """A slot's cost line. Labour is so much for every 1,000 pieces received
    (packets × pieces per packet); a per-packet rate is × packets; a fixed
    line is the amount typed."""
    if basis == "fixed":
        return amount or 0
    if rate is None:
        return 0
    if basis == "per_packet":
        return whole(rate * packets)
    return whole(rate * packets * pieces_per_packet / 1000)


def figures(run: ProductionRun) -> dict:
    """Everything the pages show about a production, from what is saved."""
    received = sum(s.packets for s in run.slots)
    pieces = received * run.pieces_per_packet
    materials = run.raw_cost + sum(c.amount for c in run.costs)
    slots_cost = sum(s.total_cost for s in run.slots)
    total = materials + slots_cost
    return {
        "slots": len(run.slots),
        "received": received,
        "pending": max(run.units - received, 0),
        "pieces_received": pieces,
        "materials_cost": materials,
        "slots_cost": slots_cost,
        "total_cost": total,
        "cost_per_packet": round(total / received, 2) if received else None,
        "cost_per_piece": round(total / pieces, 2) if pieces else None,
    }


def close_refusal(*, pending: int, early: bool, super_admin: bool) -> str | None:
    """Why the production may not be closed now, or None. With packets
    still pending only a super admin closes, and only when asked to close
    early (the page warns first)."""
    if pending == 0:
        return None
    if not super_admin:
        return f"{pending:,} packets are still pending; only a super admin can close it early"
    if not early:
        return f"{pending:,} packets are still pending; confirm closing early"
    return None


def _float(x: Decimal | None) -> float | None:
    return None if x is None else float(x)


def _cost_out(c: ProductionRunCost) -> ProductionRunCostOut:
    return ProductionRunCostOut(
        item=c.item,
        unit=c.unit,
        quantity=_float(c.quantity),
        unit_price=_float(c.unit_price),
        follows_units=c.follows_units,
        amount=c.amount,
    )


def _slot_out(s: ProductionSlot, pieces_per_packet: int) -> ProductionSlotOut:
    return ProductionSlotOut(
        id=s.id,
        number=s.number,
        received_on=s.received_on,
        packets=s.packets,
        pieces=s.packets * pieces_per_packet,
        note=s.note,
        costs=[
            ProductionSlotCostOut(
                label=c.label, basis=c.basis, rate=_float(c.rate), amount=c.amount
            )
            for c in s.costs
        ],
        total_cost=s.total_cost,
        updated_at=s.updated_at,
    )


def _summary_fields(run: ProductionRun) -> dict:
    f = figures(run)
    return {
        "id": run.id,
        "name": run.name,
        "opened_on": run.opened_on,
        "units": run.units,
        "pieces_per_packet": run.pieces_per_packet,
        "slots": f["slots"],
        "received": f["received"],
        "pending": f["pending"],
        "materials_cost": f["materials_cost"],
        "slots_cost": f["slots_cost"],
        "total_cost": f["total_cost"],
        "cost_per_packet": f["cost_per_packet"],
        "closed": run.closed_at is not None,
        "closed_early": run.closed_early,
    }


def run_out(run: ProductionRun) -> ProductionRunOut:
    f = figures(run)
    return ProductionRunOut(
        **_summary_fields(run),
        raw_kg=_float(run.raw_kg),
        raw_cost=run.raw_cost,
        raw_used_kg=_float(run.raw_used_kg),
        note=run.note,
        costs=[_cost_out(c) for c in run.costs],
        slot_list=[_slot_out(s, run.pieces_per_packet) for s in run.slots],
        pieces_received=f["pieces_received"],
        cost_per_piece=f["cost_per_piece"],
        closed_at=run.closed_at,
        updated_at=run.updated_at,
    )


# --- Applying what was typed -----------------------------------------------------


def _cost_rows(costs: list[ProductionRunCostIn], units: int, store_id: int) -> list[ProductionRunCost]:
    rows = []
    for i, c in enumerate(costs):
        quantity = Decimal(units) if c.follows_units else c.quantity
        rows.append(
            ProductionRunCost(
                store_id=store_id,
                position=i,
                item=c.item,
                unit=c.unit,
                quantity=quantity,
                unit_price=c.unit_price,
                follows_units=c.follows_units,
                amount=cost_amount(quantity, c.unit_price),
            )
        )
    return rows


def _slot_cost_rows(
    costs: list[ProductionSlotCostIn], packets: int, pieces_per_packet: int, store_id: int
) -> list[ProductionSlotCost]:
    return [
        ProductionSlotCost(
            store_id=store_id,
            position=i,
            label=c.label,
            basis=c.basis,
            rate=None if c.basis == "fixed" else c.rate,
            amount=slot_cost_amount(c.basis, c.rate, c.amount, packets, pieces_per_packet),
        )
        for i, c in enumerate(costs)
    ]


def reprice_slot(slot: ProductionSlot, pieces_per_packet: int) -> None:
    """Work a saved slot's amounts out again from its rates: after the
    order's pieces per packet changed, or the slot's packets."""
    for c in slot.costs:
        c.amount = slot_cost_amount(c.basis, c.rate, c.amount, slot.packets, pieces_per_packet)
    slot.total_cost = sum(c.amount for c in slot.costs)


# --- Loading ---------------------------------------------------------------------


async def _load(session: AsyncSession, store_id: int, run_id: int) -> ProductionRun:
    run = await session.scalar(
        select(ProductionRun).where(ProductionRun.id == run_id, ProductionRun.store_id == store_id)
    )
    if run is None:
        raise HTTPException(status_code=404, detail="No such production")
    return run


async def _reload(session: AsyncSession, store_id: int, run_id: int) -> ProductionRunOut:
    """The production as now saved. The session keeps objects after commit
    (expire_on_commit=False), so it is emptied first: the run, its lines and
    its slots are read again, server-set timestamps included."""
    session.expunge_all()
    return run_out(await _load(session, store_id, run_id))


def _open(run: ProductionRun) -> None:
    if run.closed_at is not None:
        raise HTTPException(
            status_code=409, detail="This production is closed; a super admin can reopen it"
        )


def _slot(run: ProductionRun, slot_id: int) -> ProductionSlot:
    slot = next((s for s in run.slots if s.id == slot_id), None)
    if slot is None:
        raise HTTPException(status_code=404, detail="No such slot")
    return slot


def _check_date(day: date, *, admin: bool, today: date) -> None:
    if day > today:
        raise HTTPException(status_code=400, detail="That day has not happened yet")
    if not admin and day != today:
        raise HTTPException(
            status_code=403, detail="Only a production admin can open a production on another day"
        )


# --- Endpoints -------------------------------------------------------------------


@router.get("", response_model=list[ProductionRunSummary])
async def list_runs(
    start: date | None = Query(None),
    end: date | None = Query(None),
    open_only: bool = Query(False, alias="open"),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionRunSummary]:
    """Productions opened between start and end (both inclusive, either
    open), newest first. With open=true, every production still open
    whenever it was opened, so one running across months is never lost."""
    stmt = select(ProductionRun).where(ProductionRun.store_id == ctx.store.id)
    if open_only:
        stmt = stmt.where(ProductionRun.closed_at.is_(None))
    if start is not None:
        stmt = stmt.where(ProductionRun.opened_on >= start)
    if end is not None:
        stmt = stmt.where(ProductionRun.opened_on <= end)
    runs = await session.scalars(
        stmt.order_by(ProductionRun.opened_on.desc(), ProductionRun.id.desc()).limit(400)
    )
    return [ProductionRunSummary(**_summary_fields(r)) for r in runs]


@router.get("/defaults", response_model=ProductionRunDefaults)
async def defaults(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunDefaults:
    """What a new production and a new slot start from: the latest ones'
    lines and prices, with quantities left blank, or the built-in lists."""
    store_id = ctx.store.id
    last = await session.scalar(
        select(ProductionRun)
        .where(ProductionRun.store_id == store_id)
        .order_by(ProductionRun.opened_on.desc(), ProductionRun.id.desc())
        .limit(1)
    )
    last_slot = await session.scalar(
        select(ProductionSlot)
        .where(ProductionSlot.store_id == store_id)
        .order_by(ProductionSlot.received_on.desc(), ProductionSlot.id.desc())
        .limit(1)
    )
    costs = (
        [
            ProductionRunCostOut(
                item=c.item,
                unit=c.unit,
                unit_price=_float(c.unit_price),
                follows_units=c.follows_units,
                amount=0,
            )
            for c in last.costs
        ]
        if last is not None and last.costs
        else list(DEFAULT_COSTS)
    )
    slot_costs = (
        [
            ProductionSlotCostOut(label=c.label, basis=c.basis, rate=_float(c.rate), amount=0)
            for c in last_slot.costs
        ]
        if last_slot is not None and last_slot.costs
        else list(DEFAULT_SLOT_COSTS)
    )
    return ProductionRunDefaults(
        pieces_per_packet=last.pieces_per_packet if last is not None else DEFAULT_PIECES_PER_PACKET,
        costs=costs,
        slot_costs=slot_costs,
    )


@router.get("/{run_id}", response_model=ProductionRunOut)
async def get_run(
    run_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunOut:
    return run_out(await _load(session, ctx.store.id, run_id))


@router.post("", response_model=ProductionRunOut, status_code=201)
async def open_run(
    body: ProductionRunIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunOut:
    """Open a production: the order and what was bought for all of it."""
    _check_date(body.opened_on, admin=tenancy.is_production_admin(ctx.user), today=_today())
    store_id = ctx.store.id
    run = ProductionRun(
        store_id=store_id,
        name=body.name,
        opened_on=body.opened_on,
        units=body.units,
        pieces_per_packet=body.pieces_per_packet,
        raw_kg=body.raw_kg,
        raw_cost=body.raw_cost,
        note=body.note,
        created_by_id=ctx.user.id,
        updated_by_id=ctx.user.id,
        costs=_cost_rows(body.costs, body.units, store_id),
        slots=[],
    )
    session.add(run)
    await session.commit()
    return await _reload(session, store_id, run.id)


@router.put("/{run_id}", response_model=ProductionRunOut)
async def edit_run(
    run_id: int,
    body: ProductionRunIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunOut:
    """Correct an open production, or fill in what was not known when it
    was opened. Its lines are replaced by what is sent; its slots are kept,
    their amounts worked out again if the pieces per packet changed."""
    store_id = ctx.store.id
    run = await _load(session, store_id, run_id)
    _open(run)
    admin = tenancy.is_production_admin(ctx.user)
    if body.opened_on != run.opened_on:
        if not admin:
            raise HTTPException(
                status_code=403, detail="Only a production admin can change a production's date"
            )
        if body.opened_on > _today():
            raise HTTPException(status_code=400, detail="That day has not happened yet")
        first = min((s.received_on for s in run.slots), default=None)
        if first is not None and body.opened_on > first:
            raise HTTPException(
                status_code=400, detail="A production cannot open after its first slot was received"
            )
    received = sum(s.packets for s in run.slots)
    if body.units < received:
        raise HTTPException(
            status_code=400,
            detail=f"{received:,} packets were already received; the order cannot be smaller",
        )
    run.name = body.name
    run.opened_on = body.opened_on
    run.units = body.units
    run.raw_kg = body.raw_kg
    run.raw_cost = body.raw_cost
    run.note = body.note
    run.updated_by_id = ctx.user.id
    run.costs = _cost_rows(body.costs, body.units, store_id)
    if body.pieces_per_packet != run.pieces_per_packet:
        run.pieces_per_packet = body.pieces_per_packet
        for slot in run.slots:
            reprice_slot(slot, run.pieces_per_packet)
    await session.commit()
    return await _reload(session, store_id, run_id)


@router.delete("/{run_id}", status_code=204)
async def delete_run(
    run_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_crm_admin),
) -> None:
    """Delete a production with its lines and slots (CRM admins only)."""
    run = await _load(session, ctx.store.id, run_id)
    await session.delete(run)
    await session.commit()


def _check_slot(run: ProductionRun, body: ProductionSlotIn, *, keep: ProductionSlot | None) -> None:
    if body.received_on > _today():
        raise HTTPException(status_code=400, detail="That day has not happened yet")
    if body.received_on < run.opened_on:
        raise HTTPException(
            status_code=400, detail="A slot cannot be received before the production was opened"
        )
    others = sum(s.packets for s in run.slots if s is not keep)
    room = run.units - others
    if body.packets > room:
        raise HTTPException(
            status_code=400,
            detail=f"Only {room:,} packets are pending on this production",
        )


@router.post("/{run_id}/slots", response_model=ProductionRunOut, status_code=201)
async def add_slot(
    run_id: int,
    body: ProductionSlotIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunOut:
    """Receive a slot: so many packets on a day, and what they cost. Slots
    are numbered in the order they are added."""
    store_id = ctx.store.id
    run = await _load(session, store_id, run_id)
    _open(run)
    _check_slot(run, body, keep=None)
    costs = _slot_cost_rows(body.costs, body.packets, run.pieces_per_packet, store_id)
    slot = ProductionSlot(
        store_id=store_id,
        number=max((s.number for s in run.slots), default=0) + 1,
        received_on=body.received_on,
        packets=body.packets,
        note=body.note,
        costs=costs,
        total_cost=sum(c.amount for c in costs),
        created_by_id=ctx.user.id,
        updated_by_id=ctx.user.id,
    )
    run.slots.append(slot)
    run.updated_by_id = ctx.user.id
    try:
        # Flushed first so the slot has an id for its stock row.
        await session.flush()
        await stock.follow_slot(session, ctx.store, slot, ctx.user.id)
        await session.commit()
    except IntegrityError:
        # Someone else added a slot to the same production at that moment.
        await session.rollback()
        raise HTTPException(status_code=409, detail="Another slot was just added; reload and try again")
    return await _reload(session, store_id, run_id)


@router.put("/{run_id}/slots/{slot_id}", response_model=ProductionRunOut)
async def edit_slot(
    run_id: int,
    slot_id: int,
    body: ProductionSlotIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunOut:
    """Correct a slot of an open production; its cost lines are replaced."""
    store_id = ctx.store.id
    run = await _load(session, store_id, run_id)
    _open(run)
    slot = _slot(run, slot_id)
    _check_slot(run, body, keep=slot)
    slot.received_on = body.received_on
    slot.packets = body.packets
    slot.note = body.note
    slot.costs = _slot_cost_rows(body.costs, body.packets, run.pieces_per_packet, store_id)
    slot.total_cost = sum(c.amount for c in slot.costs)
    slot.updated_by_id = ctx.user.id
    run.updated_by_id = ctx.user.id
    await stock.follow_slot(session, ctx.store, slot, ctx.user.id)
    await session.commit()
    return await _reload(session, store_id, run_id)


@router.delete("/{run_id}/slots/{slot_id}", response_model=ProductionRunOut)
async def delete_slot(
    run_id: int,
    slot_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_admin),
) -> ProductionRunOut:
    """Remove a slot from an open production (production admins only). The
    others keep their numbers, so an invoice already printed still matches.
    Its stock row goes with it (stock_movements.slot_id cascades)."""
    store_id = ctx.store.id
    run = await _load(session, store_id, run_id)
    _open(run)
    run.slots.remove(_slot(run, slot_id))
    run.updated_by_id = ctx.user.id
    await session.commit()
    return await _reload(session, store_id, run_id)


@router.post("/{run_id}/close", response_model=ProductionRunOut)
async def close_run(
    run_id: int,
    body: ProductionRunCloseIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunOut:
    """Close the production once every packet is received, recording the
    raw material used. With packets pending, a super admin may close it
    early; the page warns first."""
    store_id = ctx.store.id
    run = await _load(session, store_id, run_id)
    _open(run)
    pending = figures(run)["pending"]
    refusal = close_refusal(pending=pending, early=body.early, super_admin=ctx.is_super_admin)
    if refusal:
        raise HTTPException(status_code=403 if not ctx.is_super_admin else 409, detail=refusal)
    run.raw_used_kg = body.raw_used_kg
    run.closed_at = datetime.now(timezone.utc)
    run.closed_by_id = ctx.user.id
    run.closed_early = pending > 0
    run.updated_by_id = ctx.user.id
    await session.commit()
    return await _reload(session, store_id, run_id)


@router.post("/{run_id}/reopen", response_model=ProductionRunOut)
async def reopen_run(
    run_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionRunOut:
    """Open a closed production again, to correct it (super admins only)."""
    if not ctx.is_super_admin:
        raise HTTPException(status_code=403, detail="Only a super admin can reopen a production")
    store_id = ctx.store.id
    run = await _load(session, store_id, run_id)
    if run.closed_at is None:
        raise HTTPException(status_code=409, detail="This production is open")
    run.closed_at = None
    run.closed_by_id = None
    run.closed_early = False
    run.updated_by_id = ctx.user.id
    await session.commit()
    return await _reload(session, store_id, run_id)


@router.get("/{run_id}/slots/{slot_id}/invoice")
async def slot_invoice(
    run_id: int,
    slot_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> Response:
    """The slot as a PDF invoice: what was received and what to pay for it."""
    run = await _load(session, ctx.store.id, run_id)
    slot = _slot(run, slot_id)
    context = production_invoice.invoice_context(
        run,
        slot,
        store=ctx.store.name,
        generated_by=ctx.user.nickname or ctx.user.name,
        now=datetime.now(DHAKA),
    )
    try:
        pdf = await production_invoice.invoice_pdf(context)
    except production_report.ReportUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{context["filename"]}"'},
    )
