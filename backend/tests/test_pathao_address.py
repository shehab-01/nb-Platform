"""api.services.pathao_address: normalising addresses, reading Pathao's
parser replies, and failing soft. Run from backend/: python -m pytest tests -q"""
import asyncio

import pytest

from api.services import pathao, pathao_address
from api.services.pathao_address import ParseResult
from api.stores import PathaoConfig

CFG = PathaoConfig(client_id="c", client_secret="s", username="u", password="p", store_id=1)

ENGLISH = {
    "message": "Suggested address details.", "type": "success", "code": 200,
    "data": {
        "district_id": 1, "district_name": "Dhaka",
        "zone_id": 941, "zone_name": "Uttara Sector 10",
        "area_id": None, "area_name": None,
        "hub_id": 125, "hub_name": "Diabari", "source": "ibn",
        "ibn_chain": [
            {"id": "a", "name": "Road 5", "type": "Transport", "sub_type": "Road"},
            {"id": "b", "name": "Sector 10", "type": "SubArea", "sub_type": "Sector"},
            {"id": "c", "name": "Uttara", "type": "Area", "sub_type": "Urban"},
            {"id": "d", "name": "Dhaka", "type": "Admin", "sub_type": "District"},
        ],
        "history_verified": False,
    },
}
BANGLA = {
    "data": {
        "district_id": 32, "district_name": "B. Baria",
        "zone_id": 549, "zone_name": "Nabinagar",
        "area_id": None, "area_name": None,
        "hub_id": 157, "hub_name": "B.Baria-Nabinagar", "source": "ibn",
        "ibn_chain": [
            {"name": "Laur", "type": "Area", "sub_type": "Village"},
            {"name": "Nabinagar", "type": "Admin", "sub_type": "Upazilla"},
            {"name": "Brahamanbaria", "type": "Admin", "sub_type": "District"},
        ],
        "history_verified": False,
    },
}


def test_normalise_collapses_spacing_commas_digits_and_case():
    same = [
        "House 12, Road 5, Uttara Sector 10, Dhaka",
        "  house 12 ,road 5,,  uttara   sector 10, dhaka. ",
        "House ১২, Road ৫, Uttara Sector ১০, Dhaka",
    ]
    keys = {pathao_address.cache_key(a) for a in same}
    assert len(keys) == 1
    assert pathao_address.normalise(same[1]) == "house 12, road 5, uttara sector 10, dhaka"


def test_normalise_keeps_bangla_text():
    text = "আশিকি ট্রাভেলস ,লাউর ফতেহপুর বাজার, নবীনগর ব্রাহ্মণবাড়িয়া"
    assert pathao_address.normalise(text) == "আশিকি ট্রাভেলস, লাউর ফতেহপুর বাজার, নবীনগর ব্রাহ্মণবাড়িয়া"


def test_parse_precise_chain_is_high():
    r = pathao_address.parse_response(ENGLISH)
    assert r.matched and (r.city_id, r.zone_id, r.area_id) == (1, 941, None)
    assert r.city_name == "Dhaka" and r.zone_name == "Uttara Sector 10"
    assert r.confidence == "high"
    assert r.raw is ENGLISH["data"]


def test_parse_coarse_chain_is_medium():
    r = pathao_address.parse_response(BANGLA)
    assert r.matched and (r.city_id, r.zone_id) == (32, 549)
    assert r.confidence == "medium"


def test_history_verified_is_high_even_when_coarse():
    body = {"data": {**BANGLA["data"], "history_verified": True}}
    assert pathao_address.parse_response(body).confidence == "high"


def test_district_without_zone_is_low_and_drops_area():
    body = {"data": {"district_id": 1, "district_name": "Dhaka", "zone_id": None, "area_id": 5}}
    r = pathao_address.parse_response(body)
    assert r.matched and r.zone_id is None and r.area_id is None and r.confidence == "low"


def test_no_data_key_is_a_recorded_miss():
    r = pathao_address.parse_response({"message": "Address not found", "type": "error", "code": 200})
    assert not r.matched and r.raw == {"message": "Address not found"}
    assert not pathao_address.parse_response("<html>").matched


def test_round_trip_json():
    r = pathao_address.parse_response(ENGLISH)
    assert ParseResult.from_json(r.as_json()) == r


@pytest.fixture
def breaker():
    pathao_address.breaker.reset()
    yield pathao_address.breaker
    pathao_address.breaker.reset()


def test_breaker_opens_after_repeated_failures(breaker):
    for _ in range(pathao_address.BREAKER_FAILURES - 1):
        breaker.failed()
    assert not breaker.is_open
    breaker.failed()
    assert breaker.is_open
    breaker.succeeded()
    assert not breaker.is_open


class _NoCache:
    """A session whose cache lookups always miss and whose writes are noted."""

    def __init__(self):
        self.added = []
        self.committed = 0

    async def get(self, *_args, **_kw):
        return None

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.committed += 1


def test_parse_short_address_never_calls(monkeypatch, breaker):
    called = []
    monkeypatch.setattr(pathao_address, "_ask_pathao", lambda *a: called.append(a))
    r = asyncio.run(pathao_address.parse(_NoCache(), CFG, 1, "Dhaka"))
    assert not r.matched and called == []


def test_parse_failure_is_soft_and_counts_on_breaker(monkeypatch, breaker):
    async def boom(*_a):
        raise pathao.PathaoError("Address parser answered 500", status=500)

    monkeypatch.setattr(pathao_address, "_ask_pathao", boom)
    session = _NoCache()
    for _ in range(pathao_address.BREAKER_FAILURES):
        r = asyncio.run(pathao_address.parse(session, CFG, 1, "House 12, Road 5, Uttara"))
        assert not r.matched
    assert breaker.is_open and session.added == []


def test_parse_success_is_cached(monkeypatch, breaker):
    async def ok(*_a):
        return pathao_address.parse_response(ENGLISH)

    monkeypatch.setattr(pathao_address, "_ask_pathao", ok)
    session = _NoCache()
    r = asyncio.run(pathao_address.parse(session, CFG, 1, "House 12, Road 5, Uttara Sector 10"))
    assert r.matched and r.zone_id == 941
    assert len(session.added) == 1 and session.committed == 1
    assert session.added[0].result["zone_id"] == 941


def test_parse_skips_when_breaker_open(monkeypatch, breaker):
    called = []

    async def ok(*a):
        called.append(a)
        return pathao_address.parse_response(ENGLISH)

    monkeypatch.setattr(pathao_address, "_ask_pathao", ok)
    for _ in range(pathao_address.BREAKER_FAILURES):
        breaker.failed()
    r = asyncio.run(pathao_address.parse(_NoCache(), CFG, 1, "House 12, Road 5, Uttara Sector 10"))
    assert not r.matched and called == []


def test_booking_payload_carries_location_only_when_nested():
    from api.models import Order

    order = Order(
        customer_name="Rahim Uddin", phone="01711111111",
        address="House 12, Road 5, Uttara Sector 10, Dhaka",
        product_name="Tea", quantity=1, unit_price=100, total_amount=100, comment="",
        pathao_city_id=1, pathao_zone_id=941, pathao_area_id=None,
    )
    payload = pathao.build_order_payload(order, CFG, "NB-1")
    assert payload["recipient_city"] == 1 and payload["recipient_zone"] == 941
    assert "recipient_area" not in payload

    order.pathao_city_id = None
    payload = pathao.build_order_payload(order, CFG, "NB-1")
    assert "recipient_city" not in payload and "recipient_zone" not in payload
