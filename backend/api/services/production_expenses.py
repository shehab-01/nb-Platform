"""
The expenses a production sends to the Expenses page.

Saving a production files nothing. Its "Send to Expenses" button files three
of its costs, once, each as a single expense rather than one per line: all
the raw materials (bazar) together, all the cooks' pay together, and all the
other costs together. Gas and packaging stay on the production only. From
then on the production is locked (production_days.sent_at): it can no
longer be changed, only deleted, and deleting it deletes these expenses too.

Each such expense is filed under "From production", reads "Raw materials -
13/10" with the production's day and month, has no payment method, and
notes only the names of what it covers. It starts pending like any expense,
and the Expenses page will not edit or delete it on its own.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import tenancy
from api.models import Expense, ExpenseProof, ProductionDay
from api.services import gdrive

log = logging.getLogger(__name__)

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")

# The category every sent expense is filed under. Not one of the store's
# categories: nobody picks it by hand.
CATEGORY = "From production"

# Each part sent, and how its item reads.
PARTS = (
    ("materials", "Raw materials"),
    ("labour", "Cook salary"),
    ("misc", "Other costs"),
)

NOTE_MAX = 1000


@dataclass(frozen=True)
class Line:
    category: str
    item: str
    amount: int
    note: str | None


def _names(names: list[str]) -> str | None:
    """The names, each once, in the order first met, comma-separated."""
    text = ", ".join(dict.fromkeys(n for n in names if n))
    if not text:
        return None
    return text if len(text) <= NOTE_MAX else text[: NOTE_MAX - 1] + "…"


def lines(day: ProductionDay) -> dict[str, Line]:
    """What each part's expense says, for the parts that cost anything.
    Pure: the day as saved in, the lines out."""
    dd_mm = day.day.strftime("%d/%m")
    names = {
        "materials": _names([m.item for m in day.materials]),
        "labour": _names(
            [
                label
                for label, n in [("Male cook", day.male_cooks), ("Female cook", day.female_cooks)]
                if n
            ]
            + [c.get("label") or "Other rate" for c in day.extra_cooks or []]
        ),
        "misc": _names([m.purpose for m in day.misc]),
    }
    amounts = {
        "materials": day.materials_cost,
        "labour": day.labour_cost,
        "misc": day.misc_cost,
    }
    return {
        part: Line(
            category=CATEGORY,
            item=f"{label} - {dd_mm}",
            amount=amounts[part],
            note=names[part],
        )
        for part, label in PARTS
        if amounts[part] > 0
    }


def spent_at(day: ProductionDay, today: date, now: datetime) -> datetime:
    """When a production's expense counts as spent: now for today's
    production, else the day itself, at the time production started (noon
    when none was given), so it lands on that day's Expenses."""
    if day.day == today:
        return now
    return datetime.combine(day.day, day.starts_at or time(12), tzinfo=DHAKA)


async def linked(session: AsyncSession, store_id: int, day_id: int) -> list[Expense]:
    """The expenses the production sent, in the order of PARTS."""
    order = {part: i for i, (part, _) in enumerate(PARTS)}
    rows = await session.scalars(
        select(Expense).where(Expense.store_id == store_id, Expense.production_day_id == day_id)
    )
    return sorted(rows, key=lambda e: order.get(e.production_part or "", len(order)))


async def send(session: AsyncSession, day: ProductionDay, ctx: tenancy.StoreContext) -> None:
    """File the production's expenses and lock it (the caller commits).

    A production saved while saving still filed expenses (before the send
    button) already has some, in the old form and parts. They are rewritten
    into the sent form rather than filed twice; a part no longer sent (gas,
    packaging) is deleted."""
    now = datetime.now(DHAKA)
    when = spent_at(day, now.date(), now)
    want = lines(day)
    for expense in await linked(session, ctx.store.id, day.id):
        line = want.pop(expense.production_part or "", None)
        if line is None:
            await _discard(session, expense)
            continue
        expense.spent_at = when
        expense.category, expense.item = line.category, line.item
        expense.amount, expense.note = line.amount, line.note
        expense.payment_method = None
        expense.status, expense.approved_by_id, expense.approved_at = "pending", None, None
    # The rewritten and deleted rows go first, so no new row meets an old one.
    await session.flush()
    for part, line in want.items():
        session.add(
            Expense(
                store_id=ctx.store.id,
                spent_at=when,
                category=line.category,
                item=line.item,
                amount=line.amount,
                payment_method=None,
                note=line.note,
                added_by_name=ctx.user.nickname or ctx.user.name,
                added_by_id=ctx.user.id,
                created_by_id=ctx.user.id,
                status="pending",
                production_day_id=day.id,
                production_part=part,
            )
        )
    day.sent_at = now
    day.sent_by_id = ctx.user.id


async def _discard(session: AsyncSession, expense: Expense) -> None:
    """Delete an expense, its proofs moved to Drive's bin as the Expenses
    page does (api.routers.expenses.delete_expense); a Drive hiccup leaves
    the files in their folder but does not stop the delete."""
    file_ids = (
        await session.scalars(
            select(ExpenseProof.drive_file_id).where(
                ExpenseProof.store_id == expense.store_id, ExpenseProof.expense_id == expense.id
            )
        )
    ).all()
    for file_id in file_ids:
        try:
            await gdrive.trash(session, file_id)
        except gdrive.DriveError as err:
            log.warning("Drive: could not bin a proof of expense %s: %s", expense.id, err.message)
    await session.delete(expense)


async def remove(session: AsyncSession, day: ProductionDay, ctx: tenancy.StoreContext) -> None:
    """Delete the production's expenses along with it (the caller commits;
    only a CRM admin deletes a production: api.routers.production.delete_day)."""
    for expense in await linked(session, ctx.store.id, day.id):
        await _discard(session, expense)
