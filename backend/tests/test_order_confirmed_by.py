"""api.routers.orders: confirmed_by records who confirmed an order and keeps
it through the moves after, unlike handled_by.

Run from backend/:  python -m pytest tests -q
"""
from types import SimpleNamespace

from api.models import Order, OrderStatus
from api.routers.orders import _move_status


class _Session:
    """Just enough of AsyncSession for _move_status, which only adds events."""

    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


def test_confirming_records_the_confirmer_and_keeps_it():
    order = Order(id=1, store_id=1, status=OrderStatus.processing.value)
    session = _Session()
    alice, bob = SimpleNamespace(id=7), SimpleNamespace(id=9)

    assert _move_status(session, order, alice, OrderStatus.confirmed)
    assert order.confirmed_by == 7
    assert order.handled_by == 7

    # Shipping it moves handled_by on; who confirmed it stays.
    assert _move_status(session, order, bob, OrderStatus.shipped)
    assert order.handled_by == 9
    assert order.confirmed_by == 7


def test_other_moves_do_not_set_a_confirmer():
    order = Order(id=2, store_id=1, status=OrderStatus.processing.value)
    _move_status(_Session(), order, SimpleNamespace(id=7), OrderStatus.on_hold)
    assert order.confirmed_by is None
