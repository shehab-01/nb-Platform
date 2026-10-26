"""Pathao's status webhook: event words, ordering, and the Carrybee guards
that keep a late or mistimed event from undoing a newer status.

Run from backend/:  python -m pytest tests -q
"""
from datetime import datetime, timedelta, timezone

import pytest

from api.models import Order
from api.services import carrybee_sync, courier, pathao_sync


class _Session:
    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


def _order(**kw) -> Order:
    defaults = dict(id=7, store_id=1, courier_provider="pathao", courier_consignment_id="DL1")
    defaults.update(kw)
    return Order(**defaults)


@pytest.mark.parametrize(
    ("event", "status"),
    [
        ("order.pickup-requested", "Pickup_Requested"),
        ("order.Pickup_Requested", "Pickup_Requested"),
        ("order.at-the-sorting-hub", "At_the_Sorting_HUB"),
        ("order.delivered", "Delivered"),
        ("order.partial-delivery", "Partial_Delivery"),
        ("order.returned", "Return"),
        ("order.paid-return", "Paid_Return"),
    ],
)
def test_webhook_events_take_the_polls_spelling(event, status):
    assert pathao_sync.WEBHOOK_STATUSES[pathao_sync.webhook_event(event)] == status


def test_money_events_are_not_statuses():
    for event in ("order.created", "order.updated", "order.paid", "order.payment-invoice"):
        assert pathao_sync.webhook_event(event) in pathao_sync.NOT_A_STATUS


def test_every_mapped_settled_word_is_settled():
    for status in ("Delivered", "Partial_Delivery", "Return", "Paid_Return", "Returned_To_Merchant"):
        assert courier.is_settled("pathao", status)


def test_parse_time_needs_a_zone():
    assert pathao_sync.parse_time("2024-12-27T17:49:43+00:00") == datetime(
        2024, 12, 27, 17, 49, 43, tzinfo=timezone.utc
    )
    # Pathao's updated_at is local time without a zone: not trusted.
    assert pathao_sync.parse_time("2024-12-27 23:49:43") is None


def test_apply_status_ignores_older_and_same_state():
    session = _Session()
    t1 = datetime.now(timezone.utc) - timedelta(hours=1)
    order = _order(courier_status="In_Transit", courier_status_at=t1)

    # Earlier than what the order has: dropped.
    assert not pathao_sync.apply_status(session, order, "Picked", t1 - timedelta(minutes=5))  # type: ignore[arg-type]
    assert order.courier_status == "In_Transit"

    assert pathao_sync.apply_status(session, order, "Delivered", t1 + timedelta(minutes=5))  # type: ignore[arg-type]
    assert order.courier_status == "Delivered"
    assert session.added[-1].event_type == "pathao_status"

    # The same state in another capitalisation is no change.
    count = len(session.added)
    assert not pathao_sync.apply_status(session, order, "DELIVERED", t1 + timedelta(minutes=6))  # type: ignore[arg-type]
    assert order.courier_status == "Delivered" and len(session.added) == count


def test_future_timestamp_is_clamped_so_later_events_still_land():
    for apply, first, second in (
        (pathao_sync.apply_status, "In_Transit", "Delivered"),
        (carrybee_sync.apply_status, "in-transit", "delivered"),
    ):
        session = _Session()
        order = _order(courier_status=None, courier_status_at=None)
        # Six hours ahead: a local time written as UTC.
        assert apply(session, order, first, datetime.now(timezone.utc) + timedelta(hours=6))  # type: ignore[arg-type]
        assert order.courier_status_at <= datetime.now(timezone.utc)
        assert apply(session, order, second, datetime.now(timezone.utc))  # type: ignore[arg-type]
        assert order.courier_status == second


def test_carrybee_paid_never_replaces_delivered():
    session = _Session()
    order = _order(courier_provider="carrybee", courier_status="delivered", courier_status_at=None)
    assert not carrybee_sync.apply_status(session, order, "paid", datetime.now(timezone.utc))  # type: ignore[arg-type]
    assert order.courier_status == "delivered"
