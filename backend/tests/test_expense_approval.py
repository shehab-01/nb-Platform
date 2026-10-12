"""
Expense approval, the expenses a production day files, and the expense PDF.

Who approves, deletes and edits (the CRM admins — PRODUCTION_ADMIN_EMAILS,
not the super admin role — and an expense's own author), what each production part's expense says, when it counts as
spent, and what the expense report shows. No database, no LibreOffice.

Run from backend/:  python -m pytest tests -q
"""
import asyncio
import io
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace

import pytest
from docx import Document
from fastapi import HTTPException

from api import tenancy
from api.config import settings
from api.models import Expense, ProductionDay
from api.routers.expenses import delete_expense, edit_expense, may_edit, set_status
from api.routers.production import _apply, totals
from api.schemas import ExpenseIn, ExpenseStatusIn, ProductionDayIn, UserOut
from api.services import expense_report, production_expenses

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")
STORE = SimpleNamespace(id=2, name="Nature Bazar")
OWNER_EMAIL = "owner@example.com"


@pytest.fixture(autouse=True)
def approver(monkeypatch):
    monkeypatch.setattr(settings, "production_admin_emails", frozenset({OWNER_EMAIL}))


def ctx(email: str, role: str = "super_admin", uid: int = 7):
    user = SimpleNamespace(id=uid, email=email, name="Someone", nickname=None)
    return tenancy.StoreContext(store=STORE, role=role, user=user)


class OneExpense:
    """A session holding a single expense, for the refusals that come before
    any query."""

    def __init__(self, expense: Expense):
        self.expense = expense

    async def get(self, _model, _id):
        return self.expense


# --- Who approves ----------------------------------------------------------------


def test_only_the_production_admin_addresses_are_crm_admins():
    assert tenancy.is_crm_admin(SimpleNamespace(email="Owner@Example.com"))
    # The super admin role alone, given from the Users page, is not enough.
    assert not tenancy.is_crm_admin(SimpleNamespace(email="other-admin@example.com"))


def test_the_admin_learns_whether_it_is_a_crm_admin():
    base = dict(
        id=1, name="X", picture_url=None, role="super_admin", status="active",
        created_at=datetime(2026, 1, 1), last_active_at=None,
    )
    assert UserOut(email=OWNER_EMAIL, **base).crm_admin
    assert not UserOut(email="other@example.com", **base).crm_admin


def test_another_super_admin_cannot_approve():
    with pytest.raises(HTTPException) as err:
        asyncio.run(set_status(1, ExpenseStatusIn(status="approved"), None, ctx("other@example.com")))
    assert err.value.status_code == 403


def test_another_super_admin_cannot_delete():
    with pytest.raises(HTTPException) as err:
        asyncio.run(delete_expense(1, None, ctx("other@example.com")))
    assert err.value.status_code == 403


def test_a_production_expense_is_not_deleted_from_expenses():
    linked = Expense(id=1, store_id=2, production_day_id=5, production_part="materials")
    with pytest.raises(HTTPException) as err:
        asyncio.run(delete_expense(1, OneExpense(linked), ctx(OWNER_EMAIL)))
    assert err.value.status_code == 409


def test_a_production_expense_is_not_edited_from_expenses():
    linked = Expense(id=1, store_id=2, production_day_id=5, production_part="materials")
    body = ExpenseIn(category="Utilities", item="Gas", amount=100, payment_method="cash")
    with pytest.raises(HTTPException) as err:
        asyncio.run(edit_expense(1, body, OneExpense(linked), ctx(OWNER_EMAIL)))
    assert err.value.status_code == 409


# --- Cooks at other rates ----------------------------------------------------------


def a_day(**kw) -> ProductionDayIn:
    base = dict(
        male_cooks=6,
        male_rate=450,
        female_cooks=4,
        female_rate=400,
        extra_cooks=[{"label": "Head cook", "cooks": 1, "rate": 900}, {"cooks": 2, "rate": 600}],
        gas_cost=6800,
        packaging_cost=0,
        materials=[
            {"item": "Mustard oil", "quantity": "12", "unit_price": 220},
            {"item": "Others", "amount": 800},
        ],
        batches=[{"product": "Padmar Ilish", "patils": 1, "jars_per_patil": 200}],
        misc=[{"purpose": "Transport", "amount": 2500, "note": "van"}],
    )
    return ProductionDayIn(**(base | kw))


def test_cooks_at_other_rates_count_into_labour():
    # 6×450 + 4×400 + 1×900 + 2×600
    assert totals(a_day())["labour_cost"] == 2700 + 1600 + 900 + 1200


def test_an_extra_cooks_line_needs_at_least_one_cook():
    with pytest.raises(Exception):
        a_day(extra_cooks=[{"cooks": 0, "rate": 500}])


def saved(body: ProductionDayIn, d: date = date(2026, 10, 9)) -> ProductionDay:
    row = ProductionDay(day=d)
    _apply(row, body, 2, {"Mustard oil": "L", "Others": None})
    return row


# --- What a production files -----------------------------------------------------


def test_a_day_files_raw_materials_and_cook_salary_only():
    lines = production_expenses.lines(saved(a_day()))
    # Gas and other costs stay on the production.
    assert set(lines) == {"materials", "labour"}
    assert lines["materials"].amount == 12 * 220 + 800
    assert lines["materials"].category == "Market & Grocery"
    assert lines["labour"].category == "Salary"
    assert lines["labour"].amount == 6400
    assert lines["materials"].item == "Production 9 Oct 2026 · Raw materials"
    assert lines["labour"].item == "Production 9 Oct 2026 · Cook salary"


def test_a_part_that_cost_nothing_files_nothing():
    lines = production_expenses.lines(saved(a_day(materials=[])))
    assert set(lines) == {"labour"}


def test_a_parts_note_lists_what_it_is_made_of():
    lines = production_expenses.lines(saved(a_day()))
    assert lines["materials"].note == "Mustard oil 12 লিটার ৳2,640; Others ৳800"
    assert lines["labour"].note == (
        "Male 6 × ৳450; Female 4 × ৳400; Head cook 1 × ৳900; Other rate 2 × ৳600"
    )


def test_todays_production_is_spent_now_an_earlier_one_on_its_day():
    now = datetime(2026, 10, 12, 15, 30, tzinfo=DHAKA)
    today = saved(a_day(), date(2026, 10, 12))
    assert production_expenses.spent_at(today, now.date(), now) == now
    earlier = saved(a_day(starts_at="08:00"), date(2026, 10, 9))
    assert production_expenses.spent_at(earlier, now.date(), now) == datetime(
        2026, 10, 9, 8, 0, tzinfo=DHAKA
    )
    no_time = saved(a_day(), date(2026, 10, 9))
    assert production_expenses.spent_at(no_time, now.date(), now).time() == time(12)


# --- The PDF -------------------------------------------------------------------------


def expense(i: int, amount: int, day: date, note: str | None = None) -> Expense:
    return Expense(
        id=i,
        spent_at=datetime.combine(day, time(10), tzinfo=DHAKA),
        category="Packaging",
        item=f"Jar {i}",
        amount=amount,
        note=note,
        added_by_name="Shehab",
    )


def test_the_report_lists_each_expense_and_the_total():
    rows = [
        expense(1, 6250, date(2026, 10, 1), "200g"),
        expense(2, 1500, date(2026, 10, 12)),
    ]
    c = expense_report.report_context(
        rows, store="Nature Bazar", generated_by="Shehab", now=datetime(2026, 10, 12, 18, 0)
    )
    assert c["period"] == "1 Oct 2026 – 12 Oct 2026"
    assert c["total"] == "৳7,750"
    assert [r["added_by"] for r in c["rows"]] == ["Shehab", "Shehab"]
    assert c["filename"] == "expenses-2026-10-01_2026-10-12.pdf"

    text = " ".join(
        cell.text
        for table in Document(io.BytesIO(expense_report.render_docx(c))).tables
        for r in table.rows
        for cell in r.cells
    )
    for want in ("Jar 1", "200g", "Packaging", "Shehab", "৳6,250", "Total", "৳7,750"):
        assert want in text


def test_a_one_day_report_names_the_day():
    c = expense_report.report_context(
        [expense(1, 100, date(2026, 10, 12))], store="S", generated_by="G", now=datetime(2026, 10, 12)
    )
    assert c["period"] == "12 Oct 2026"
    assert c["filename"] == "expenses-2026-10-12.pdf"


# --- Who edits ----------------------------------------------------------------------


def test_the_author_and_crm_admins_may_edit_an_expense():
    mine = Expense(id=1, store_id=2, created_by_id=7)
    assert may_edit(mine, ctx("staff@example.com", role="staff", uid=7))
    assert not may_edit(mine, ctx("staff@example.com", role="staff", uid=8))
    # A super admin by role is no exception; a CRM admin is.
    assert not may_edit(mine, ctx("other@example.com", uid=8))
    assert may_edit(mine, ctx(OWNER_EMAIL, uid=8))


def test_someone_elses_expense_is_not_edited():
    theirs = Expense(id=1, store_id=2, created_by_id=99)
    body = ExpenseIn(category="Utilities", item="Gas", amount=100, payment_method="cash")
    with pytest.raises(HTTPException) as err:
        asyncio.run(edit_expense(1, body, OneExpense(theirs), ctx("staff@example.com", role="staff")))
    assert err.value.status_code == 403


def test_a_crm_admin_opens_expenses_without_the_flag():
    access = tenancy.StoreAccess(1, "s", "S", "staff", crm=False)
    got = tenancy.accessible(SimpleNamespace(email=OWNER_EMAIL, role="staff"), [access], [])
    assert got[0].crm and got[0].production == tenancy.PRODUCTION_ADMIN


def test_another_super_admin_cannot_manage_access():
    with pytest.raises(HTTPException) as err:
        asyncio.run(tenancy.require_crm_admin(ctx("other@example.com")))
    assert err.value.status_code == 403
