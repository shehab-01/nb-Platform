"""
A store's stock of packets (stores.stock_enabled), kept as a ledger:
stock_movements, one signed row per change. Stock in hand is their sum.

  slot    + a production slot received, one row per slot (follow_slot)
  sale    − an order moved to History, one row per order (follow_status)
  return  + so many of one option the courier brought back
  adjust  ± a correction an admin typed

Why History and not "shipped": in this business the parcel is booked with
the courier, the sticker printed and the parcel handed over, and only then
is the order moved to History. That move is the one step every dispatched
order goes through exactly once, so it is the one that takes stock.

How many packets an order takes: each line's quantity × its option's
stock_packets (the 3-packet combo is 3). The count is worked out when the
order goes to History and kept on the row, so the past reads as it was.
sync() is the repair: it brings the ledger in line with the slots and the
History list as they are now — rows that should be there and are not, and
rows whose count has drifted — and never touches returns or adjustments.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.models import (
    Order,
    OrderEvent,
    OrderStatus,
    Product,
    ProductionSlot,
    ProductVariant,
    StockMovement,
)

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")

SLOT = "slot"
SALE = "sale"
RETURN = "return"
ADJUST = "adjust"
KINDS = (SLOT, SALE, RETURN, ADJUST)

HISTORY = OrderStatus.history.value


def today() -> date:
    return datetime.now(DHAKA).date()


def dhaka_day(moment: datetime) -> date:
    return moment.astimezone(DHAKA).date()


# --- Pure rules -----------------------------------------------------------------


def sale_packets(
    lines: list[tuple[int, int | None]], packets_by_variant: dict[int, int]
) -> tuple[int, int]:
    """Packets an order takes, from its lines as (quantity, variant id), and
    how many lines could not be sized (the option was deleted, or the line
    names none) and were counted at one packet each."""
    total = 0
    unsized = 0
    for quantity, variant_id in lines:
        per = packets_by_variant.get(variant_id) if variant_id is not None else None
        if per is None:
            per = 1
            unsized += 1
        total += quantity * per
    return total, unsized


def order_lines(order: Order) -> list[tuple[int, int | None]]:
    """An order's lines as (quantity, variant id). An order from before
    order_items has only its summary columns: one line of no known option."""
    if order.items:
        return [(item.quantity, item.variant_id) for item in order.items]
    return [(order.quantity or 1, None)]


def status_change(old: str, new: str) -> str | None:
    """What moving an order from old to new does to stock: "take" when it
    enters History, "give_back" when it leaves it, else None."""
    if new == HISTORY and old != HISTORY:
        return "take"
    if old == HISTORY and new != HISTORY:
        return "give_back"
    return None


@dataclass
class DayRow:
    day: date
    received: int = 0
    sent: int = 0
    returned: int = 0
    adjusted: int = 0
    closing: int = 0


def day_rows(opening: int, movements: list[tuple[date, str, int]]) -> list[DayRow]:
    """The month's days that had a movement, oldest first, each with what
    came in, went out, came back and was corrected, and the stock at the end
    of it. sent is a positive count; adjusted keeps its sign."""
    by_day: dict[date, DayRow] = {}
    for day, kind, packets in movements:
        row = by_day.setdefault(day, DayRow(day))
        if kind == SLOT:
            row.received += packets
        elif kind == SALE:
            row.sent -= packets
        elif kind == RETURN:
            row.returned += packets
        else:
            row.adjusted += packets
    running = opening
    rows = sorted(by_day.values(), key=lambda r: r.day)
    for row in rows:
        running += row.received - row.sent + row.returned + row.adjusted
        row.closing = running
    return rows


# --- The ledger --------------------------------------------------------------------


async def variant_packets(session: AsyncSession, store_id: int) -> dict[int, int]:
    """Every option of the store's products, with its packets."""
    rows = await session.execute(
        select(ProductVariant.id, ProductVariant.stock_packets)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(Product.store_id == store_id)
    )
    return {vid: packets for vid, packets in rows.all()}


async def _sale_row(session: AsyncSession, store_id: int, order_id: int) -> StockMovement | None:
    return await session.scalar(
        select(StockMovement).where(
            StockMovement.store_id == store_id,
            StockMovement.kind == SALE,
            StockMovement.order_id == order_id,
        )
    )


async def follow_status(
    session: AsyncSession,
    store: stores.StoreConfig,
    order: Order,
    old: str,
    new: str,
    user_id: int | None,
) -> None:
    """Keep stock in step with an order's move: into History takes its
    packets, out of History (a mistake undone) puts them back. Nothing for a
    store that keeps no stock."""
    if not store.stock_enabled:
        return
    change = status_change(old, new)
    if change == "take":
        if await _sale_row(session, store.id, order.id) is not None:
            return
        packets, _ = sale_packets(order_lines(order), await variant_packets(session, store.id))
        session.add(
            StockMovement(
                store_id=store.id,
                kind=SALE,
                on_day=today(),
                packets=-packets,
                order_id=order.id,
                created_by_id=user_id,
            )
        )
    elif change == "give_back":
        await session.execute(
            delete(StockMovement).where(
                StockMovement.store_id == store.id,
                StockMovement.kind == SALE,
                StockMovement.order_id == order.id,
            )
        )


async def follow_slot(
    session: AsyncSession, store: stores.StoreConfig, slot: ProductionSlot, user_id: int | None
) -> None:
    """A slot received or corrected: its row carries its packets and day.
    (A deleted slot takes its row with it, by the foreign key.) The slot
    must be flushed, so it has an id."""
    if not store.stock_enabled:
        return
    row = await session.scalar(
        select(StockMovement).where(
            StockMovement.store_id == store.id, StockMovement.slot_id == slot.id
        )
    )
    if row is None:
        session.add(
            StockMovement(
                store_id=store.id,
                kind=SLOT,
                on_day=slot.received_on,
                packets=slot.packets,
                slot_id=slot.id,
                created_by_id=user_id,
            )
        )
    else:
        row.on_day = slot.received_on
        row.packets = slot.packets


async def on_hand(session: AsyncSession, store_id: int, *, before: date | None = None) -> int:
    """Packets in stock: everything, or everything before a day."""
    query = select(func.coalesce(func.sum(StockMovement.packets), 0)).where(
        StockMovement.store_id == store_id
    )
    if before is not None:
        query = query.where(StockMovement.on_day < before)
    return int(await session.scalar(query) or 0)


@dataclass
class SyncResult:
    slots_added: int = 0
    slots_updated: int = 0
    sales_added: int = 0
    sales_updated: int = 0
    sales_removed: int = 0
    # Orders with a line whose option is gone, counted at one packet a line.
    unsized_orders: int = 0


async def sync(session: AsyncSession, store_id: int, user_id: int | None) -> SyncResult:
    """Bring the slot and sale rows in line with the slots received and the
    orders in History now. Safe to run any number of times. Returns and
    adjustments are typed by people and left alone."""
    result = SyncResult()

    # Slots: one row each, with the slot's packets and day.
    slot_rows = {
        r.slot_id: r
        for r in await session.scalars(
            select(StockMovement).where(
                StockMovement.store_id == store_id, StockMovement.kind == SLOT
            )
        )
    }
    for slot in await session.scalars(
        select(ProductionSlot).where(ProductionSlot.store_id == store_id)
    ):
        row = slot_rows.get(slot.id)
        if row is None:
            session.add(
                StockMovement(
                    store_id=store_id,
                    kind=SLOT,
                    on_day=slot.received_on,
                    packets=slot.packets,
                    slot_id=slot.id,
                    created_by_id=user_id,
                )
            )
            result.slots_added += 1
        elif (row.packets, row.on_day) != (slot.packets, slot.received_on):
            row.packets = slot.packets
            row.on_day = slot.received_on
            result.slots_updated += 1

    # Sales: one row for each order in History, none for any other.
    sale_rows = {
        r.order_id: r
        for r in await session.scalars(
            select(StockMovement).where(
                StockMovement.store_id == store_id, StockMovement.kind == SALE
            )
        )
    }
    sizes = await variant_packets(session, store_id)
    # The day each order last went to History, from its status events.
    moved = dict(
        (
            await session.execute(
                select(OrderEvent.order_id, func.max(OrderEvent.created_at))
                .where(
                    OrderEvent.store_id == store_id,
                    OrderEvent.event_type == "status_changed",
                    OrderEvent.new_status == HISTORY,
                )
                .group_by(OrderEvent.order_id)
            )
        ).all()
    )
    in_history: set[int] = set()
    for order in await session.scalars(
        select(Order).where(Order.store_id == store_id, Order.status == HISTORY)
    ):
        in_history.add(order.id)
        packets, unsized = sale_packets(order_lines(order), sizes)
        if unsized:
            result.unsized_orders += 1
        row = sale_rows.get(order.id)
        if row is None:
            when = moved.get(order.id) or order.updated_at or order.created_at
            session.add(
                StockMovement(
                    store_id=store_id,
                    kind=SALE,
                    on_day=dhaka_day(when),
                    packets=-packets,
                    order_id=order.id,
                    created_by_id=user_id,
                )
            )
            result.sales_added += 1
        elif not unsized and row.packets != -packets:
            # An option's packets corrected, or the order's lines changed.
            # An order whose option is gone keeps what it was counted at.
            row.packets = -packets
            result.sales_updated += 1
    for order_id, row in sale_rows.items():
        if order_id not in in_history:
            await session.delete(row)
            result.sales_removed += 1
    return result
