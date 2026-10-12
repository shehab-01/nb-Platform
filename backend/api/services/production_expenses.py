"""
The expenses a production day files for itself.

Saving a production day files its costs on the Expenses page, one expense
per part rather than one per bazar line: all the raw materials together, all
the cooks together, the gas, the packaging, the other costs. Saving the day
again updates those same expenses (found by production_day_id and
production_part), adds a part that now has a cost and removes one that no
longer has; deleting the day removes them. They are changed only through the
day: the Expenses page shows them but will not edit or delete them.

They follow the Expenses rules otherwise. Each starts pending; one the
approver (SUPER_ADMIN_EMAILS, tenancy.is_expense_approver) approved goes back
to pending when anyone else changes what it says, and a day whose expenses
include an approved one can be deleted only by the approver.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import tenancy
from api.models import Expense, ExpenseProof, ProductionDay
from api.services import gdrive
from api.services.production_report import quantity, taka

log = logging.getLogger(__name__)

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")

# Each part, the expense category it is filed under (one of the defaults in
# api.routers.expenses.DEFAULT_CATEGORIES, which every store has) and how
# its item reads.
PARTS = (
    ("materials", "Market & Grocery", "Raw materials"),
    ("labour", "Salary", "Cooks' pay"),
    ("gas", "Utilities", "Gas / fuel"),
    ("packaging", "Packaging", "Packaging"),
    ("misc", "Miscellaneous", "Other costs"),
)

NOTE_MAX = 1000


@dataclass(frozen=True)
class Line:
    category: str
    item: str
    amount: int
    note: str | None


def _clip(text: str) -> str | None:
    if not text:
        return None
    return text if len(text) <= NOTE_MAX else text[: NOTE_MAX - 1] + "…"


def _day_label(d: date) -> str:
    return d.strftime("%d %b %Y").lstrip("0")


def lines(day: ProductionDay) -> dict[str, Line]:
    """What each part's expense says, for the parts that cost anything.
    Pure: the day as saved in, the lines out."""
    notes = {
        "materials": "; ".join(
            f"{m.item} {quantity(m.quantity, m.unit)} {taka(m.amount)}"
            if m.quantity is not None
            else f"{m.item} {taka(m.amount)}"
            for m in day.materials
        ),
        "labour": "; ".join(
            f"{label} {n} × {taka(rate)}"
            for label, n, rate in [
                ("Male", day.male_cooks, day.male_rate),
                ("Female", day.female_cooks, day.female_rate),
            ]
            + [(c.get("label") or "Other rate", c["cooks"], c["rate"]) for c in day.extra_cooks or []]
            if n
        ),
        "gas": "",
        "packaging": "",
        "misc": "; ".join(
            f"{m.purpose} {taka(m.amount)}" + (f" ({m.note})" if m.note else "") for m in day.misc
        ),
    }
    amounts = {
        "materials": day.materials_cost,
        "labour": day.labour_cost,
        "gas": day.gas_cost,
        "packaging": day.packaging_cost,
        "misc": day.misc_cost,
    }
    return {
        part: Line(
            category=category,
            item=f"Production {_day_label(day.day)} · {label}",
            amount=amounts[part],
            note=_clip(notes[part]),
        )
        for part, category, label in PARTS
        if amounts[part] > 0
    }


def spent_at(day: ProductionDay, today: date, now: datetime) -> datetime:
    """When a production day's expense counts as spent: now for today's
    production, else the day itself, at the time production started (noon
    when none was given), so it lands on that day's Expenses."""
    if day.day == today:
        return now
    return datetime.combine(day.day, day.starts_at or time(12), tzinfo=DHAKA)


async def _linked(session: AsyncSession, store_id: int, day_id: int) -> list[Expense]:
    return list(
        await session.scalars(
            select(Expense).where(
                Expense.store_id == store_id, Expense.production_day_id == day_id
            )
        )
    )


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


async def sync(session: AsyncSession, day: ProductionDay, ctx: tenancy.StoreContext) -> None:
    """Bring the day's expenses in line with the day as just saved (the day
    must have its id: flush first). The caller commits."""
    store_id = ctx.store.id
    now = datetime.now(DHAKA)
    when = spent_at(day, now.date(), now)
    want = lines(day)
    have = {e.production_part: e for e in await _linked(session, store_id, day.id)}

    gone = [e for part, e in have.items() if part not in want]
    # Refused before anything is touched, Drive included.
    for expense in gone:
        if expense.status == "approved" and not tenancy.is_expense_approver(ctx.user):
            raise HTTPException(
                status_code=403,
                detail=f"“{expense.item}” is approved; only the approver can remove it",
            )
    for expense in gone:
        await _discard(session, expense)

    for part, line in want.items():
        expense = have.get(part)
        if expense is None:
            session.add(
                Expense(
                    store_id=store_id,
                    spent_at=when,
                    category=line.category,
                    item=line.item,
                    amount=line.amount,
                    payment_method="cash",
                    note=line.note,
                    added_by_name=ctx.user.nickname or ctx.user.name,
                    added_by_id=ctx.user.id,
                    created_by_id=ctx.user.id,
                    status="pending",
                    production_day_id=day.id,
                    production_part=part,
                )
            )
            continue
        changed = (expense.category, expense.item, expense.amount, expense.note) != (
            line.category,
            line.item,
            line.amount,
            line.note,
        )
        expense.category, expense.item = line.category, line.item
        expense.amount, expense.note = line.amount, line.note
        # A production moved to another date takes its expenses with it.
        if expense.spent_at.astimezone(DHAKA).date() != day.day:
            expense.spent_at = when
        if changed and not tenancy.is_expense_approver(ctx.user):
            expense.status, expense.approved_by_id, expense.approved_at = "pending", None, None


async def remove(session: AsyncSession, day: ProductionDay, ctx: tenancy.StoreContext) -> None:
    """Delete the day's expenses along with it (the caller commits). An
    approved one stops the delete unless the approver is doing it."""
    linked = await _linked(session, ctx.store.id, day.id)
    if not tenancy.is_expense_approver(ctx.user) and any(e.status == "approved" for e in linked):
        raise HTTPException(
            status_code=403,
            detail="This production's expenses include an approved one; only the approver can delete it",
        )
    for expense in linked:
        await _discard(session, expense)
