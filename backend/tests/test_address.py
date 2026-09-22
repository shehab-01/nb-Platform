"""api.address: the storefront's minimum for a deliverable address.
Run from backend/: python -m pytest tests -q"""
import pytest
from pydantic import ValidationError

from api.address import valid_address
from api.schemas import OrderCreate, OrderDraft


@pytest.mark.parametrize(
    "address",
    [
        "House 12, Road 5, Mirpur, Dhaka",
        "মিরপুর ১০, ঢাকা",
        "12 Road-5 Dhaka",
        "  Sector 10   Uttara  ",
        "বাসা ১২ গ্রাম নয়াপাড়া",
    ],
)
def test_accepts_real_addresses(address):
    assert valid_address(address)


@pytest.mark.parametrize(
    "address",
    [
        "",
        "Dhaka",
        "Dhaka Dhaka",
        "12 34 56",
        "১২ ৩৪ ৫৬",
        "- , . Dhaka",
        "Dhaka, - -",
    ],
)
def test_rejects_short_or_numeric_addresses(address):
    assert not valid_address(address)


def _order(address: str) -> dict:
    return {"customer_name": "A", "phone": "01712345678", "address": address}


def test_order_create_enforces_the_rule():
    assert OrderCreate(**_order("House 12, Mirpur, Dhaka")).address
    with pytest.raises(ValidationError) as exc:
        OrderCreate(**_order("Dhaka"))
    assert "address" in str(exc.value)


def test_drafts_keep_whatever_was_typed():
    # An abandoned form is a lead, not an order: never refuse to save it.
    assert OrderDraft(draft_key="k" * 8, phone="0171234", address="Dhaka").address == "Dhaka"
