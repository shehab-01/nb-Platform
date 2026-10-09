"""The CRM's Production Cost page: what a day of cooking costs, down to the jar.

A day is a production day when it has a production_days row; saving the
drawer creates or replaces that row, and removing it makes the day an
ordinary day again. Every total — line amounts, labour, the day's cost, jars,
cost per jar — is worked out here from what was typed, never taken from the
browser. Same access as Expenses (tenancy.require_crm), and nothing here
reads or writes expenses: this page is a costing, Expenses is what was paid.

The bazar list is picked from the store's raw-material items, and what is
cooked from the store's products; both lists are kept by the same people on
the same page. A day copies the names (and an item's unit) it uses, so
editing or removing an item or product never rewrites a day already saved.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import tenancy
from api.db import get_session
from api.models import (
    ProductionBatch,
    ProductionDay,
    ProductionItem,
    ProductionMaterial,
    ProductionMisc,
    ProductionProduct,
)
from api.schemas import (
    ProductionDayIn,
    ProductionDayOut,
    ProductionDaySummary,
    ProductionItemIn,
    ProductionItemOut,
    ProductionProductIn,
    ProductionProductOut,
    ProductionSuggestions,
)

router = APIRouter(prefix="/production", tags=["Production"])

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")

# Every new store starts with these raw materials; they are ordinary rows the
# store may then edit or remove (migrations 0035–0036 gave existing stores the
# same). Names are Bangla, as the bazar is; units are codes the admin shows in
# Bangla.
DEFAULT_ITEMS = (
    ("সরিষার তেল", "L"),
    ("সরিষা", "kg"),
    ("মেথি", "kg"),
    ("রসুন", "kg"),
    ("কাঁচা মরিচ", "kg"),
    ("আদা", "kg"),
    ("লবণ", "kg"),
    ("মশলা (মিক্স)", "kg"),
)

_require = tenancy.require_crm


def _today() -> date:
    return datetime.now(DHAKA).date()


def seed_items(session: AsyncSession, store_id: int) -> None:
    """Give a new store the default raw materials (the caller commits)."""
    session.add_all(
        ProductionItem(store_id=store_id, name=name, unit=unit) for name, unit in DEFAULT_ITEMS
    )


def line_amount(quantity: Decimal | None, unit_price: int | None, amount: int | None) -> int:
    """A bazar line's taka: quantity × unit price, rounded half up to whole
    taka, when both are given; otherwise the lump sum typed."""
    if quantity is not None and unit_price is not None:
        return int((quantity * unit_price).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    assert amount is not None  # ProductionMaterialIn guarantees one or the other
    return amount


def totals(body: ProductionDayIn) -> dict[str, int]:
    """The day's figures, as stored on production_days."""
    materials = sum(line_amount(m.quantity, m.unit_price, m.amount) for m in body.materials)
    labour = body.male_cooks * body.male_rate + body.female_cooks * body.female_rate
    misc = sum(m.amount for m in body.misc)
    return {
        "materials_cost": materials,
        "labour_cost": labour,
        "misc_cost": misc,
        "total_cost": materials + labour + body.gas_cost + body.packaging_cost + misc,
        "patils": sum(b.patils for b in body.batches),
        "jars": sum(b.patils * b.jars_per_patil for b in body.batches),
    }


def _apply(
    row: ProductionDay, body: ProductionDayIn, store_id: int, units: dict[str, str | None]
) -> None:
    """Copy the drawer onto a day, replacing its lines and its totals. units
    is each item's unit by name, from the store's item list."""
    row.starts_at = body.starts_at
    row.ends_at = body.ends_at
    row.shifts = [s.model_dump(mode="json") for s in body.shifts]
    row.male_cooks, row.male_rate = body.male_cooks, body.male_rate
    row.female_cooks, row.female_rate = body.female_cooks, body.female_rate
    row.gas_cost = body.gas_cost
    row.packaging_cost = body.packaging_cost
    row.note = body.note
    for key, value in totals(body).items():
        setattr(row, key, value)
    row.materials = [
        ProductionMaterial(
            store_id=store_id,
            position=i,
            item=m.item,
            quantity=m.quantity,
            unit=units.get(m.item),
            unit_price=m.unit_price,
            amount=line_amount(m.quantity, m.unit_price, m.amount),
        )
        for i, m in enumerate(body.materials)
    ]
    row.batches = [
        ProductionBatch(
            store_id=store_id,
            position=i,
            product=b.product,
            patils=b.patils,
            jars_per_patil=b.jars_per_patil,
            jars=b.patils * b.jars_per_patil,
        )
        for i, b in enumerate(body.batches)
    ]
    row.misc = [
        ProductionMisc(
            store_id=store_id, position=i, purpose=m.purpose, amount=m.amount, note=m.note
        )
        for i, m in enumerate(body.misc)
    ]


async def _load(
    session: AsyncSession, store_id: int, day: date, *, fresh: bool = False
) -> ProductionDay | None:
    stmt = select(ProductionDay).where(
        ProductionDay.store_id == store_id, ProductionDay.day == day
    )
    if fresh:
        stmt = stmt.execution_options(populate_existing=True)
    return await session.scalar(stmt)


# --- The two lists: products and raw-material items ------------------------------


async def _products(session: AsyncSession, store_id: int) -> list[ProductionProduct]:
    return list(
        await session.scalars(
            select(ProductionProduct)
            .where(ProductionProduct.store_id == store_id)
            .order_by(ProductionProduct.created_at, ProductionProduct.id)
        )
    )


async def _items(session: AsyncSession, store_id: int) -> list[ProductionItem]:
    return list(
        await session.scalars(
            select(ProductionItem)
            .where(ProductionItem.store_id == store_id)
            .order_by(ProductionItem.created_at, ProductionItem.id)
        )
    )


def _check_name(rows: list, name: str, *, keep: int | None, what: str) -> None:
    """A name already on the list, in any letter case, is refused rather
    than duplicated (renaming a row to its own name is fine)."""
    if any(r.name.casefold() == name.casefold() and r.id != keep for r in rows):
        raise HTTPException(status_code=409, detail=f"That {what} is already on the list")


async def _own(session: AsyncSession, model, store_id: int, row_id: int, what: str):
    row = await session.get(model, row_id)
    if row is None or row.store_id != store_id:
        raise HTTPException(status_code=404, detail=f"No such {what}")
    return row


@router.get("/products", response_model=list[ProductionProductOut])
async def list_products(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionProduct]:
    """What this store cooks, oldest first."""
    return await _products(session, ctx.store.id)


@router.post("/products", response_model=list[ProductionProductOut], status_code=201)
async def add_product(
    body: ProductionProductIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionProduct]:
    """Add a product; returns the whole list."""
    _check_name(await _products(session, ctx.store.id), body.name, keep=None, what="product")
    session.add(ProductionProduct(store_id=ctx.store.id, name=body.name, icon=body.icon))
    await session.commit()
    return await _products(session, ctx.store.id)


@router.put("/products/{product_id}", response_model=list[ProductionProductOut])
async def edit_product(
    product_id: int,
    body: ProductionProductIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionProduct]:
    """Rename a product or change its icon; returns the whole list. Days
    already saved keep the name they were saved with."""
    product = await _own(session, ProductionProduct, ctx.store.id, product_id, "product")
    _check_name(await _products(session, ctx.store.id), body.name, keep=product.id, what="product")
    product.name, product.icon = body.name, body.icon
    await session.commit()
    return await _products(session, ctx.store.id)


@router.delete("/products/{product_id}", response_model=list[ProductionProductOut])
async def delete_product(
    product_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionProduct]:
    """Remove a product; returns the whole list. Days it was cooked on keep
    its name, so the past reads as it was."""
    product = await _own(session, ProductionProduct, ctx.store.id, product_id, "product")
    await session.delete(product)
    await session.commit()
    return await _products(session, ctx.store.id)


@router.get("/items", response_model=list[ProductionItemOut])
async def list_items(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionItem]:
    """The raw materials this store buys, oldest first."""
    return await _items(session, ctx.store.id)


@router.post("/items", response_model=list[ProductionItemOut], status_code=201)
async def add_item(
    body: ProductionItemIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionItem]:
    """Add a raw material; returns the whole list."""
    _check_name(await _items(session, ctx.store.id), body.name, keep=None, what="item")
    session.add(ProductionItem(store_id=ctx.store.id, name=body.name, unit=body.unit))
    await session.commit()
    return await _items(session, ctx.store.id)


@router.put("/items/{item_id}", response_model=list[ProductionItemOut])
async def edit_item(
    item_id: int,
    body: ProductionItemIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionItem]:
    """Rename a raw material or change its unit; returns the whole list.
    Days already saved keep the name and unit they were saved with."""
    item = await _own(session, ProductionItem, ctx.store.id, item_id, "item")
    _check_name(await _items(session, ctx.store.id), body.name, keep=item.id, what="item")
    item.name, item.unit = body.name, body.unit
    await session.commit()
    return await _items(session, ctx.store.id)


@router.delete("/items/{item_id}", response_model=list[ProductionItemOut])
async def delete_item(
    item_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionItem]:
    """Remove a raw material; returns the whole list. Days that bought it
    keep it, so the past reads as it was."""
    item = await _own(session, ProductionItem, ctx.store.id, item_id, "item")
    await session.delete(item)
    await session.commit()
    return await _items(session, ctx.store.id)


@router.get("/suggestions", response_model=ProductionSuggestions)
async def suggestions(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionSuggestions:
    """The purposes other costs were given before, most recently used first."""
    store_id = ctx.store.id
    purposes: dict[str, str] = {}
    for (purpose,) in await session.execute(
        select(ProductionMisc.purpose)
        .join(ProductionDay, ProductionDay.id == ProductionMisc.production_day_id)
        .where(ProductionMisc.store_id == store_id, ProductionDay.store_id == store_id)
        .order_by(ProductionDay.day.desc(), ProductionMisc.position)
        .limit(1000)
    ):
        purposes.setdefault(purpose.casefold(), purpose)
    return ProductionSuggestions(purposes=list(purposes.values())[:50])


# --- Days ----------------------------------------------------------------------


@router.get("/days", response_model=list[ProductionDaySummary])
async def list_days(
    start: date | None = Query(None),
    end: date | None = Query(None),
    limit: int = Query(31, ge=1, le=400),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ProductionDaySummary]:
    """Production days, newest first: those between start and end (both
    inclusive, either open), at most `limit`. The list page asks for a month;
    the entry page asks for the latest one to start from."""
    stmt = select(
        ProductionDay.id,
        ProductionDay.day,
        ProductionDay.patils,
        ProductionDay.jars,
        ProductionDay.total_cost,
    ).where(ProductionDay.store_id == ctx.store.id)
    if start is not None:
        stmt = stmt.where(ProductionDay.day >= start)
    if end is not None:
        stmt = stmt.where(ProductionDay.day <= end)
    rows = (await session.execute(stmt.order_by(ProductionDay.day.desc()).limit(limit))).all()

    names: dict[int, list[str]] = {}
    if rows:
        for day_id, product in await session.execute(
            select(ProductionBatch.production_day_id, ProductionBatch.product)
            .where(
                ProductionBatch.store_id == ctx.store.id,
                ProductionBatch.production_day_id.in_([r[0] for r in rows]),
            )
            .order_by(ProductionBatch.production_day_id, ProductionBatch.position)
        ):
            names.setdefault(day_id, []).append(product)
    return [
        ProductionDaySummary(
            day=d,
            products=len(names.get(day_id, [])),
            product_names=names.get(day_id, []),
            patils=patils,
            jars=jars,
            total_cost=total,
            cost_per_jar=round(total / jars, 2) if jars else 0.0,
        )
        for day_id, d, patils, jars, total in rows
    ]


@router.get("/days/{day}", response_model=ProductionDayOut | None)
async def get_day(
    day: date,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionDay | None:
    """The day as saved, or null when it is not a production day."""
    return await _load(session, ctx.store.id, day)


def _refuse_unknown(names: set[str], allowed: set[str], what: str) -> None:
    unknown = sorted(names - allowed)
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Not on the store's {what} list: {', '.join(unknown)}"
        )


def date_refusal(
    *, super_admin: bool, day: date, today: date, new: bool, moving: bool
) -> str | None:
    """Why this save may not happen on this date, or None. A production is
    recorded for today; only a super admin may record an earlier day or move
    a production to another date. Correcting a production keeps its date, so
    anyone with CRM access may do that whenever it was."""
    if day > today:
        return "That day has not happened yet"
    if super_admin:
        return None
    if moving:
        return "Only a super admin can change a production's date"
    if new and day != today:
        return "Only a super admin can record a production for another day"
    return None


@router.put("/days/{day}", response_model=ProductionDayOut)
async def save_day(
    day: date,
    body: ProductionDayIn,
    from_day: date | None = Query(
        None, description="Move the production saved on this date to `day`"
    ),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ProductionDay:
    """Record a production for the day, or correct one: the whole day is
    replaced by what the form sends. With from_day, the production saved on
    that date is corrected and moved to `day` (super admin only)."""
    store_id = ctx.store.id
    moving = from_day is not None and from_day != day
    row = await _load(session, store_id, from_day if moving else day)
    if moving and row is None:
        raise HTTPException(status_code=404, detail="No production on the date to move from")
    refusal = date_refusal(
        super_admin=ctx.is_super_admin,
        day=day,
        today=_today(),
        new=row is None,
        moving=moving,
    )
    if refusal:
        status = 400 if day > _today() else 403
        raise HTTPException(status_code=status, detail=refusal)
    if moving and await _load(session, store_id, day) is not None:
        raise HTTPException(status_code=409, detail="That date already has a production")

    # Products and items come from the store's lists. One removed from a list
    # since stays valid on a production that already has it, with its unit.
    products = {p.name for p in await _products(session, store_id)}
    units: dict[str, str | None] = {}
    if row is not None:
        products |= {b.product for b in row.batches}
        units |= {m.item: m.unit for m in row.materials}
    units |= {i.name: i.unit for i in await _items(session, store_id)}
    _refuse_unknown({b.product for b in body.batches}, products, "product")
    _refuse_unknown({m.item for m in body.materials}, set(units), "raw material")

    if row is None:
        row = ProductionDay(store_id=store_id, day=day, created_by_id=ctx.user.id)
        session.add(row)
    row.day = day
    row.updated_by_id = ctx.user.id
    _apply(row, body, store_id, units)
    try:
        await session.commit()
    except IntegrityError:
        # Someone else recorded a production for this date at the same moment.
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="That date already has a production; reload and try again"
        )
    saved = await _load(session, store_id, day, fresh=True)
    assert saved is not None
    return saved


@router.delete("/days/{day}", status_code=204)
async def delete_day(
    day: date,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> None:
    """Delete the production recorded for the day."""
    row = await _load(session, ctx.store.id, day)
    if row is None:
        raise HTTPException(status_code=404, detail="No production on that date")
    await session.delete(row)
    await session.commit()
