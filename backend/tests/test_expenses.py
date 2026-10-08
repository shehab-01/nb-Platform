"""
api.routers.expenses: who an expense is put down to, and who may record one.

The rule under test is _apply's: a new expense is the signed-in user's; only
a super admin may write in another name, and an owner can never rewrite who
an existing expense belongs to. No database needed.

Run from backend/:  python -m pytest tests -q
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from api import tenancy
from api.models import Expense
from api.routers.expenses import _apply
from api.schemas import ExpenseCategoryIn, ExpenseIn

STORE = SimpleNamespace(id=2)


def ctx(role: str, uid: int = 7, name: str = "Shehab Uddin", nickname: str | None = "Shehab"):
    user = SimpleNamespace(id=uid, name=name, nickname=nickname)
    return tenancy.StoreContext(store=STORE, role=role, user=user)


def body(**kw) -> ExpenseIn:
    base = dict(category="Packaging", item="Jar 200g", amount=6250, payment_method="cash")
    return ExpenseIn(**(base | kw))


def test_a_new_expense_is_the_signed_in_users():
    e = Expense()
    _apply(e, body(), ctx("owner"), new=True)
    assert (e.added_by_name, e.added_by_id) == ("Shehab", 7)


def test_the_full_name_stands_in_without_a_nickname():
    e = Expense()
    _apply(e, body(), ctx("owner", nickname=None), new=True)
    assert e.added_by_name == "Shehab Uddin"


def test_a_super_admin_may_write_in_another_name():
    e = Expense()
    _apply(e, body(added_by_name="Rafi"), ctx("super_admin"), new=True)
    assert (e.added_by_name, e.added_by_id) == ("Rafi", None)


def test_a_super_admin_naming_themselves_stays_linked_to_them():
    e = Expense()
    _apply(e, body(added_by_name="Shehab"), ctx("super_admin"), new=True)
    assert (e.added_by_name, e.added_by_id) == ("Shehab", 7)


def test_an_owner_cannot_write_in_another_name():
    e = Expense()
    _apply(e, body(added_by_name="Rafi"), ctx("owner"), new=True)
    assert (e.added_by_name, e.added_by_id) == ("Shehab", 7)


def test_an_owner_editing_keeps_who_it_was_put_down_to():
    e = Expense(added_by_name="Rafi", added_by_id=None)
    _apply(e, body(amount=7000, added_by_name="Someone"), ctx("owner"), new=False)
    assert (e.added_by_name, e.added_by_id, e.amount) == ("Rafi", None, 7000)


def test_a_super_admin_editing_without_a_name_keeps_it():
    e = Expense(added_by_name="Rafi", added_by_id=None)
    _apply(e, body(), ctx("super_admin"), new=False)
    assert e.added_by_name == "Rafi"


class FakeSession:
    """Answers require_crm's one lookup: the membership's crm_access."""

    def __init__(self, crm_access):
        self.crm_access = crm_access
        self.asked = False

    async def scalar(self, _query):
        self.asked = True
        return self.crm_access


def crm_check(role: str, crm_access):
    session = FakeSession(crm_access)
    result = asyncio.run(tenancy.require_crm(ctx=ctx(role), session=session))
    return result, session


def test_a_super_admin_always_opens_the_crm_without_a_lookup():
    result, session = crm_check("super_admin", None)
    assert result.is_super_admin and not session.asked


@pytest.mark.parametrize("role", ["owner", "manager", "staff"])
def test_any_role_opens_the_crm_when_a_super_admin_gave_access(role):
    result, _ = crm_check(role, True)
    assert result.role == role


@pytest.mark.parametrize("role", ["owner", "manager", "staff"])
def test_no_role_opens_the_crm_by_itself(role):
    with pytest.raises(HTTPException) as err:
        crm_check(role, False)
    assert err.value.status_code == 403


def test_the_crm_is_not_a_role_permission():
    # Owners no longer get it by being owners: it is not on the role table.
    assert "expenses" not in tenancy.PERMISSIONS and "crm" not in tenancy.PERMISSIONS


def test_the_drawer_cannot_send_a_date_or_a_bad_amount():
    assert "spent_at" not in ExpenseIn.model_fields
    with pytest.raises(ValidationError):
        body(amount=0)
    with pytest.raises(ValidationError):
        body(payment_method="cheque")


def test_a_category_name_is_tidied():
    assert ExpenseCategoryIn(name="  Office   Rent ").name == "Office Rent"


def test_a_category_icon_is_a_plain_key():
    assert ExpenseCategoryIn(name="Rent").icon == "tag"
    assert ExpenseCategoryIn(name="Rent", icon="building-2").icon == "building-2"
    for bad in ("<script>", "Tag", "", "a" * 41):
        with pytest.raises(ValidationError):
            ExpenseCategoryIn(name="Rent", icon=bad)
