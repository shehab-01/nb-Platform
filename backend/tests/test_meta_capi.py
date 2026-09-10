"""
meta_capi delivery: retries with backoff, final failures parked.

The HTTP side is httpx.MockTransport; the database side (persist_failed) is
replaced with a recorder. RETRY_DELAYS is zeroed where the test is about the
outcome, and asyncio.sleep is recorded where the test is about the backoff.
"""
import asyncio

import httpx
import pytest

from api.config import settings
from api.services import meta_capi
from api.stores import MetaConfig

EVENT = {"event_name": "Purchase", "event_id": "NB-1", "action_source": "website"}
# The store's Meta settings, as the loader hands them to the sender.
META = MetaConfig(pixel_id="123", access_token="tok")
STORE = 7


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setattr(meta_capi, "RETRY_DELAYS", (0, 0, 0))
    yield
    monkeypatch.setattr(meta_capi, "transport", None)


@pytest.fixture
def parked(monkeypatch):
    rows: list[tuple[dict, int, str]] = []

    async def record(event, store_id, attempts, last_error):
        assert store_id == STORE
        rows.append((event, attempts, last_error))

    monkeypatch.setattr(meta_capi, "persist_failed", record)
    return rows


def responses(*items):
    """A transport answering with each item in turn: an int status, or an
    exception instance to raise."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        item = items[min(len(calls) - 1, len(items) - 1)]
        if isinstance(item, Exception):
            raise item
        return httpx.Response(item, json={"events_received": 1} if item < 300 else {"error": item})

    meta_capi.transport = httpx.MockTransport(handler)
    return calls


def run(coro):
    return asyncio.run(coro)


# --- success ------------------------------------------------------------------


def test_first_attempt_success(parked):
    calls = responses(200)
    result = run(meta_capi.deliver_or_park(EVENT, META, STORE))
    assert result == meta_capi.Delivery(ok=True, attempts=1)
    assert len(calls) == 1
    assert parked == []


def test_request_shape():
    calls = responses(200)
    run(meta_capi.deliver(EVENT, META))
    req = calls[0]
    assert req.method == "POST"
    assert req.url.host == "graph.facebook.com"
    assert req.url.path == f"/{settings.meta_api_version}/123/events"
    assert req.url.params["access_token"] == "tok"
    assert httpx.Response(200, content=req.content).json() == {"data": [EVENT]}


def test_test_event_code_is_attached_when_set():
    calls = responses(200)
    run(meta_capi.deliver(EVENT, MetaConfig("123", "tok", "TEST123")))
    body = httpx.Response(200, content=calls[0].content).json()
    assert body["test_event_code"] == "TEST123"


# --- retries --------------------------------------------------------------------


@pytest.mark.parametrize(
    "first",
    [
        httpx.ConnectTimeout("slow"),
        httpx.ReadTimeout("slow"),
        httpx.ConnectError("down"),
        500,
        503,
        429,
    ],
)
def test_transient_failures_are_retried(parked, first):
    calls = responses(first, 200)
    result = run(meta_capi.deliver_or_park(EVENT, META, STORE))
    assert result.ok is True
    assert result.attempts == 2
    assert len(calls) == 2
    assert parked == []


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_other_4xx_are_final(parked, status):
    calls = responses(status, 200)
    result = run(meta_capi.deliver_or_park(EVENT, META, STORE))
    assert result.ok is False
    assert result.attempts == 1
    assert len(calls) == 1
    # ... but still parked, so a fixed token can be followed by a resend.
    assert len(parked) == 1
    event, attempts, error = parked[0]
    assert event is EVENT and attempts == 1
    assert error.startswith(f"HTTP {status}: ")


def test_gives_up_after_all_retries_and_parks(parked):
    calls = responses(httpx.ConnectError("down"))
    result = run(meta_capi.deliver_or_park(EVENT, META, STORE))
    assert result.ok is False
    assert result.attempts == 1 + len(meta_capi.RETRY_DELAYS) == 4
    assert len(calls) == 4
    assert len(parked) == 1
    event, attempts, error = parked[0]
    assert event is EVENT and attempts == 4 and error.startswith("ConnectError")


def test_backoff_delays_are_1_3_9_seconds(monkeypatch, parked):
    monkeypatch.setattr(meta_capi, "RETRY_DELAYS", (1.0, 3.0, 9.0))
    slept: list[float] = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(meta_capi.asyncio, "sleep", fake_sleep)
    responses(500, 500, 500, 200)
    result = run(meta_capi.deliver(EVENT, META))
    assert result.ok is True and result.attempts == 4
    assert slept == [1.0, 3.0, 9.0]


def test_no_sleep_after_the_last_failure(monkeypatch, parked):
    monkeypatch.setattr(meta_capi, "RETRY_DELAYS", (1.0, 3.0, 9.0))
    slept: list[float] = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(meta_capi.asyncio, "sleep", fake_sleep)
    responses(500)
    run(meta_capi.deliver(EVENT, META))
    assert slept == [1.0, 3.0, 9.0]  # three pauses for four attempts, none after


def test_resend_mode_is_a_single_attempt():
    calls = responses(500, 200)
    result = run(meta_capi.deliver(EVENT, META, retry=False))
    assert result.ok is False and result.attempts == 1
    assert len(calls) == 1


# --- dispatch / drain -----------------------------------------------------------


def test_dispatch_runs_detached_and_drain_waits(parked):
    calls = responses(200)

    async def scenario():
        meta_capi.dispatch(EVENT, META, STORE)
        assert meta_capi.pending() == 1
        await meta_capi.drain()
        assert meta_capi.pending() == 0

    run(scenario())
    assert len(calls) == 1


def test_dispatch_is_a_noop_when_disabled():
    calls = responses(200)

    async def scenario():
        # A store with a pixel but no token: nothing goes out, nothing parks.
        meta_capi.dispatch(EVENT, MetaConfig(pixel_id="123"), STORE)
        await meta_capi.drain()

    run(scenario())
    assert calls == []


def test_send_purchase_builds_and_dispatches(parked):
    calls = responses(200)
    ctx = meta_capi.ClientContext(
        ip="8.8.8.8", user_agent="UA", fbp="fb.1.1.1", fbc=None, source_url="https://s/"
    )

    async def scenario():
        meta_capi.send_purchase(
            META,
            STORE,
            order_no="NB-7",
            customer_name="Rahim Uddin",
            phone="01712345678",
            quantity=2,
            unit_price=745,
            created_at=1_700_000_000,
            ctx=ctx,
            sku="SKU-1",
        )
        await meta_capi.drain()

    run(scenario())
    event = httpx.Response(200, content=calls[0].content).json()["data"][0]
    assert event["event_name"] == "Purchase"
    assert event["event_id"] == "NB-7"
    assert event["custom_data"]["value"] == 1490
    assert event["custom_data"]["content_ids"] == ["SKU-1"]
    assert event["user_data"]["fbp"] == "fb.1.1.1"
    assert event["user_data"]["client_ip_address"] == "8.8.8.8"
    # PII is hashed, never raw.
    assert "01712345678" not in calls[0].content.decode()
    assert len(event["user_data"]["ph"][0]) == 64


# --- helpers ----------------------------------------------------------------------


def test_fbclid_from_url():
    assert meta_capi.fbclid_from("https://s/?a=1&fbclid=XyZ_-1") == "XyZ_-1"
    assert meta_capi.fbclid_from("https://s/?a=1") is None
    assert meta_capi.fbclid_from(None) is None
    assert meta_capi.fbclid_from("https://s/?fbclid=") is None


def test_synthesise_fbc():
    assert meta_capi.synthesise_fbc("ABC", now_ms=1700000000000) == "fb.1.1700000000000.ABC"
