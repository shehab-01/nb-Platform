"""api.services.fraudbd: parsing FraudBD's answers and the HTTP call.
Run from backend/: python -m pytest tests -q"""
import asyncio
from decimal import Decimal

import httpx
import pytest

from api.services import fraudbd

RATING = {
    "status": True,
    "message": "ok",
    "data": {
        "Summaries": {
            "Pathao": {"logo": "https://example.com/pathao-logo.png",
                        "data_type": "rating", "customer_rating": "good_customer",
                        "risk_level": "low", "message": "Good", "success_rate": 85,
                        "total": 0, "success": 0, "cancel": 0},
            "Steadfast": {"data_type": "delivery", "total": 8, "success": 7, "cancel": 1},
        },
        "totalSummary": {"total": 8, "success": 7, "cancel": 1, "successRate": 87.5, "cancelRate": 12.5},
    },
}


def test_parse_rating_and_delivery_mix():
    r = fraudbd.parse(RATING)
    assert (r.total, r.success, r.cancel) == (8, 7, 1)
    assert r.success_rate == Decimal("87.50")
    assert r.pathao_rating == "good_customer" and r.pathao_risk == "low"
    names = {c.name: c for c in r.couriers}
    assert names["Pathao"].data_type == "rating" and names["Pathao"].success_rate == 85
    assert names["Steadfast"].success == 7
    assert names["Pathao"].logo == "https://example.com/pathao-logo.png"
    assert names["Pathao"].as_json()["logo"] == "https://example.com/pathao-logo.png"


def test_parse_new_customer_has_no_rate():
    body = {"status": True, "data": {"Summaries": {}, "totalSummary": {"total": 0, "successRate": 0}}}
    r = fraudbd.parse(body)
    assert r.total == 0 and r.success_rate is None and r.couriers == ()


def test_parse_failure_raises():
    with pytest.raises(fraudbd.FraudbdError, match="Usage limit"):
        fraudbd.parse({"status": False, "message": "Usage limit (daily) reached.", "data": None})


def test_lookup_sends_key_and_phone(monkeypatch):
    monkeypatch.setenv("FRAUDBD_SANDBOX", "1")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=RATING)

    monkeypatch.setattr(fraudbd, "transport", httpx.MockTransport(handler))
    r = asyncio.run(fraudbd.lookup("01712345678", "k3y"))
    assert r.success == 7
    req = seen[0]
    assert req.url.path == "/api/sandbox/check-courier-info"
    assert req.headers["api_key"] == "k3y"
    assert httpx.Response(200, content=req.content).json() == {"phone_number": "01712345678"}


def test_lookup_production_url(monkeypatch):
    monkeypatch.delenv("FRAUDBD_SANDBOX", raising=False)
    seen: list[httpx.Request] = []
    monkeypatch.setattr(
        fraudbd, "transport",
        httpx.MockTransport(lambda r: (seen.append(r), httpx.Response(200, json=RATING))[1]),
    )
    asyncio.run(fraudbd.lookup("01712345678", "k"))
    assert seen[0].url.path == "/api/check-courier-info"


def test_lookup_errors(monkeypatch):
    monkeypatch.setattr(fraudbd, "transport", httpx.MockTransport(
        lambda r: httpx.Response(429, json={"status": False, "message": "slow down"})))
    with pytest.raises(fraudbd.FraudbdError, match="rate limit"):
        asyncio.run(fraudbd.lookup("01712345678", "k"))

    def boom(request):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(fraudbd, "transport", httpx.MockTransport(boom))
    with pytest.raises(fraudbd.FraudbdError, match="Could not reach"):
        asyncio.run(fraudbd.lookup("01712345678", "k"))
    with pytest.raises(fraudbd.FraudbdError, match="not configured"):
        asyncio.run(fraudbd.lookup("01712345678", ""))


def test_check_order_later_without_key_is_noop():
    async def scenario():
        fraudbd.check_order_later(1, 1, "01712345678", "")
        assert not fraudbd._tasks

    asyncio.run(scenario())
