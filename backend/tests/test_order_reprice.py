"""api.routers.orders._reprice: staff repricing an order from its modal.

Run from backend/:  python -m pytest tests -q
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.models import Order, OrderItem, OrderStatus
from api.routers.orders import _reprice
from api.schemas import OrderPricingIn


class _Session:
    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


STAFF = SimpleNamespace(id=7)


def _order(**kw) -> Order:
    items = [
        OrderItem(id=11, product_name="Honey 1kg", unit_price=1250, quantity=2),
        OrderItem(id=12, product_name="Ghee", unit_price=900, quantity=1),
    ]
    defaults = dict(
        id=1, store_id=1, status=OrderStatus.processing.value,
        quantity=3, unit_price=1133, total_amount=3400, items=items,
    )
    defaults.update(kw)
    return Order(**defaults)


def _pricing(lines, discount=0) -> OrderPricingIn:
    return OrderPricingIn(
        lines=[{"item_id": i, "unit_price": p} for i, p in lines], discount=discount
    )


def test_new_prices_and_discount_set_the_total_server_side():
    order, session = _order(), _Session()
    _reprice(session, order, STAFF, _pricing([(11, 1200), (12, 900)], discount=100))
    assert [i.unit_price for i in order.items] == [1200, 900]
    assert order.total_amount == 1200 * 2 + 900 - 100
    assert order.unit_price == order.total_amount // 3
    [event] = session.added
    assert event.event_type == "price_updated"
    assert "৳3400 → ৳3200" in event.note


def test_unchanged_total_logs_nothing():
    session = _Session()
    _reprice(session, _order(), STAFF, _pricing([(11, 1250), (12, 900)]))
    assert session.added == []


def test_refused_once_booked_with_the_courier():
    for order in (_order(courier_consignment_id="DL123"), _order(status="shipped")):
        with pytest.raises(HTTPException) as exc:
            _reprice(_Session(), order, STAFF, _pricing([(11, 1)]))
        assert exc.value.status_code == 409


def test_rejects_foreign_lines_and_oversized_discounts():
    with pytest.raises(HTTPException):
        _reprice(_Session(), _order(), STAFF, _pricing([(99, 1)]))
    with pytest.raises(HTTPException):
        _reprice(_Session(), _order(), STAFF, _pricing([(11, 10), (12, 10)], discount=31))


def test_orders_without_line_items_reprice_their_one_line():
    order = _order(items=[], quantity=2, unit_price=1250, total_amount=2500)
    _reprice(_Session(), order, STAFF, _pricing([(0, 1100)], discount=200))
    assert order.unit_price == 1100
    assert order.total_amount == 2000
