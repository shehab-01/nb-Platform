"""
api.services.stock and api.routers.stock: how many packets an order takes
out of stock, when a status move takes or gives back, how a month's days
add up, and who may do what. No database needed.

Run from backend/:  python -m pytest tests -q
"""
import asyncio
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from api import tenancy
from api.models import UserRole
from api.routers.stock import _keeps_stock, month_bounds
from api.schemas import StockAdjustIn, StockReturnIn, VariantSave
from api.services import stock
from api.stores import StoreConfig

# --- Packets an order takes ---------------------------------------------------


def test_each_combo_counts_its_packets():
    # Lines as (quantity, packets each as ordered): 3, 5 and 10-packet combos.
    assert stock.sale_packets([(1, 3)]) == 3
    assert stock.sale_packets([(1, 10)]) == 10
    # Two of the 5-packet combo and one 3-packet combo on one order.
    assert stock.sale_packets([(2, 5), (1, 3)]) == 13


def test_75_orders_of_the_3_packet_combo_take_225():
    assert sum(stock.sale_packets([(1, 3)]) for _ in range(75)) == 225


def test_a_line_counts_what_it_held_when_ordered_not_what_its_option_says_now():
    # Eco-Tine turned its 5-packet option into the 10-packet one. A line
    # ordered before keeps its own 5, whatever the option holds today.
    old = SimpleNamespace(
        items=[SimpleNamespace(quantity=1, variant_id=4, stock_packets=5)], quantity=1
    )
    assert stock.sale_packets(stock.order_lines(old)) == 5


def test_an_order_from_before_order_items_counts_one_a_piece():
    old = SimpleNamespace(items=[], quantity=2)
    assert stock.order_lines(old) == [(2, 1)]
    assert stock.sale_packets([(2, 0)]) == 2


def test_the_order_line_copies_the_options_packets():
    from api.catalogue import sellable
    from api.routers.orders import _line

    product = SimpleNamespace(id=1, title="হারবাল সিগারেট")
    variant = SimpleNamespace(
        id=9, label="৫ প্যাকেট", unit_price=1090, sku="eco-05", stock_packets=5
    )
    line = _line(sellable(product, variant), 2)
    assert (line.variant_id, line.quantity, line.stock_packets) == (9, 2, 5)


# --- When stock moves --------------------------------------------------------


def test_only_the_move_into_history_takes_stock():
    assert stock.status_change("shipped", "history") == "take"
    assert stock.status_change("confirmed", "history") == "take"
    assert stock.status_change("shipped", "confirmed") is None
    assert stock.status_change("processing", "shipped") is None
    assert stock.status_change("history", "history") is None


def test_moving_out_of_history_gives_it_back():
    assert stock.status_change("history", "shipped") == "give_back"
    assert stock.status_change("history", "cancelled") == "give_back"


def test_a_store_without_stock_is_left_alone():
    # No session is touched: follow_status returns before any query.
    store = StoreConfig(id=1, slug="n", name="N", template="classic", currency="BDT")
    order = SimpleNamespace(id=5, items=[], quantity=1)
    asyncio.run(stock.follow_status(None, store, order, "shipped", "history", 1))  # type: ignore[arg-type]
    slot = SimpleNamespace(id=1, packets=100, received_on=date(2026, 11, 19))
    asyncio.run(stock.follow_slot(None, store, slot, 1))  # type: ignore[arg-type]


# --- A month in days ------------------------------------------------------------


def test_days_add_up_to_the_closing_stock():
    d1, d2 = date(2026, 11, 3), date(2026, 11, 4)
    rows = stock.day_rows(
        100,
        [
            (d2, stock.SALE, -30),
            (d1, stock.SLOT, 1200),
            (d1, stock.SALE, -210),
            (d2, stock.RETURN, 6),
            (d2, stock.ADJUST, -4),
        ],
    )
    assert [r.day for r in rows] == [d1, d2]
    first, second = rows
    assert (first.received, first.sent, first.returned, first.adjusted) == (1200, 210, 0, 0)
    assert first.closing == 100 + 1200 - 210
    assert (second.sent, second.returned, second.adjusted) == (30, 6, -4)
    assert second.closing == first.closing - 30 + 6 - 4


def test_stock_may_go_below_zero():
    rows = stock.day_rows(0, [(date(2026, 11, 1), stock.SALE, -9)])
    assert rows[0].closing == -9


def test_month_bounds():
    assert month_bounds("2026-11") == (date(2026, 11, 1), date(2026, 12, 1))
    assert month_bounds("2026-12") == (date(2026, 12, 1), date(2027, 1, 1))
    with pytest.raises(HTTPException):
        month_bounds("2026-13")


# --- Who and what ------------------------------------------------------------------


def _ctx(enabled: bool) -> tenancy.StoreContext:
    store = StoreConfig(
        id=1, slug="e", name="Eco", template="classic", currency="BDT", stock_enabled=enabled
    )
    return tenancy.StoreContext(store=store, role="owner", user=SimpleNamespace(id=1))


def test_the_stock_page_is_refused_to_a_store_without_stock():
    with pytest.raises(HTTPException) as err:
        _keeps_stock(_ctx(False))
    assert err.value.status_code == 409
    assert _keeps_stock(_ctx(True)).store.stock_enabled


def test_super_admins_see_which_stores_keep_stock():
    admin = SimpleNamespace(id=1, email="boss@example.com", role=UserRole.super_admin)
    stores_ = [
        tenancy.StoreAccess(1, "a", "A", "", True),
        tenancy.StoreAccess(2, "e", "Eco", "", True, stock_enabled=True),
    ]
    got = {a.store_id: a.stock_enabled for a in tenancy.accessible(admin, [], stores_)}
    assert got == {1: False, 2: True}


def test_a_correction_needs_a_change_and_a_reason():
    with pytest.raises(ValidationError):
        StockAdjustIn(packets=0, note="recount")
    with pytest.raises(ValidationError):
        StockAdjustIn(packets=-5, note="   ")
    assert StockAdjustIn(packets=-5, note=" damaged ").note == "damaged"


def test_a_return_needs_at_least_one_combo():
    with pytest.raises(ValidationError):
        StockReturnIn(variant_id=11, combos=0)
    assert StockReturnIn(variant_id=11, combos=4).combos == 4


def test_an_option_holds_one_packet_unless_told():
    base = {"unit_price": 750, "sku": "eco-3"}
    assert VariantSave(**base).stock_packets == 1
    assert VariantSave(**base, stock_packets=3).stock_packets == 3
    with pytest.raises(ValidationError):
        VariantSave(**base, stock_packets=0)
