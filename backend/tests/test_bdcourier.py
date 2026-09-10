"""api.services.bdcourier: parsing BDCourier's answers and the HTTP call.
Run from backend/: python -m pytest tests -q"""
import asyncio
from decimal import Decimal

import httpx
import pytest

from api.services import bdcourier

RESPONSE = {
    "status": "success",
    "data": {
        "pathao": {
            "name": "Pathao", "logo": "https://example.com/pathao-logo.png",
            "total_parcel": 8, "success_parcel": 7, "cancelled_parcel": 1, "success_ratio": 87.5,
        },
        "steadfast": {
            "name": "SteadFast", "total_parcel": 2, "success_parcel": 1,
            "cancelled_parcel": 1, "success_ratio": 50,
        },
        "summary": {
            "total_parcel": 10, "success_parcel": 8, "cancelled_parcel": 2, "success_ratio": 80,
        },
    },
    "reports": [
        {
            "id": "abc123", "name": "John Doe", "details": "Fraud reported by merchant",
            "created_at": "2024-01-01T00:00:00.000000Z",
            "courierLogo": "https://example.com/steadfast-logo.png", "courierName": "SteadFast",
        }
    ],
}


def test_parse_couriers_and_summary():
    r = bdcourier.parse(RESPONSE)
    assert (r.total, r.success, r.cancel) == (10, 8, 2)
    assert r.success_rate == Decimal("80.00")
    names = {c.name: c for c in r.couriers}
    assert names["Pathao"].success_rate == 87.5
    assert names["Pathao"].logo == "https://example.com/pathao-logo.png"
    assert names["Pathao"].as_json()["success"] == 7
    assert names["SteadFast"].cancel == 1
    assert len(r.reports) == 1
    assert r.reports[0].name == "John Doe" and r.reports[0].courier_name == "SteadFast"
    assert r.reports[0].as_json()["id"] == "abc123"


def test_parse_new_customer_has_no_rate():
    body = {"status": "success", "data": {"summary": {"total_parcel": 0, "success_ratio": 0}}}
    r = bdcourier.parse(body)
    assert r.total == 0 and r.success_rate is None and r.couriers == () and r.reports == ()


def test_parse_failure_raises():
    with pytest.raises(bdcourier.BdcourierError, match="Usage limit"):
        bdcourier.parse({"status": "error", "message": "Usage limit (daily) reached."})


def test_lookup_sends_key_and_phone(monkeypatch):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=RESPONSE)

    monkeypatch.setattr(bdcourier, "transport", httpx.MockTransport(handler))
    r = asyncio.run(bdcourier.lookup("01712345678", "k3y"))
    assert r.success == 8
    req = seen[0]
    assert req.url == "https://api.bdcourier.com/courier-check"
    assert req.headers["authorization"] == "Bearer k3y"
    assert httpx.Response(200, content=req.content).json() == {"phone": "01712345678"}


def test_lookup_errors(monkeypatch):
    monkeypatch.setattr(bdcourier, "transport", httpx.MockTransport(
        lambda r: httpx.Response(429, json={"status": "error", "message": "slow down"})))
    with pytest.raises(bdcourier.BdcourierError, match="rate limit"):
        asyncio.run(bdcourier.lookup("01712345678", "k"))

    def boom(request):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(bdcourier, "transport", httpx.MockTransport(boom))
    with pytest.raises(bdcourier.BdcourierError, match="Could not reach"):
        asyncio.run(bdcourier.lookup("01712345678", "k"))
    with pytest.raises(bdcourier.BdcourierError, match="not configured"):
        asyncio.run(bdcourier.lookup("01712345678", ""))


def test_check_order_later_without_key_is_noop():
    async def scenario():
        bdcourier.check_order_later(1, 1, "01712345678", "")
        assert not bdcourier._tasks

    asyncio.run(scenario())
