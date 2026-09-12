"""api.services.domain_health: what a live probe of a store's domain means.

Every outcome the admin's pill shows is pinned here with a mocked transport,
because the difference between them is the whole point: "Active" in our
database and "actually serving" are two different facts.

Run from backend/:  python -m pytest tests -q
"""
import asyncio
import ssl
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api import stores as stores_mod
from api import tenancy
from api.auth import get_current_user
from api.db import get_session
from api.models import UserRole
from api.routers import stores as stores_router
from api.services import domain_health as dh
from api.stores import StoreConfig

STORE_ID = 7


def body(store_id=STORE_ID, slug="myshop", active=True):
    return {
        "platform": dh.PLATFORM,
        "store": {"id": store_id, "slug": slug, "name": "My Shop", "active": active},
    }


def responder(monkeypatch, handler):
    """Point the module's httpx client at `handler` for one test."""
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(dh, "transport", httpx.MockTransport(wrapped))
    return seen


def run_probe(host="shop.example.com", store_id=STORE_ID, is_active=True):
    return asyncio.run(dh.probe(host, store_id, is_active))


@pytest.fixture(autouse=True)
def _clear_cache():
    dh.invalidate()
    yield
    dh.invalidate()


# --- the five outcomes -------------------------------------------------------


def test_ok_when_the_domain_serves_this_store(monkeypatch):
    seen = responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    result = run_probe()
    assert result.status == dh.OK
    assert result.http_status == 200
    assert result.reached_store_slug == "myshop"
    # HTTPS, the store's own hostname, and the platform's own check route.
    assert str(seen[0].url) == "https://shop.example.com/api/store-check"


def test_wrong_store_when_the_domain_serves_someone_else(monkeypatch):
    responder(monkeypatch, lambda r: httpx.Response(200, json=body(store_id=9, slug="other")))
    result = run_probe()
    assert result.status == dh.WRONG_STORE
    assert result.reached_store_slug == "other"
    assert "other" in result.detail


def test_wrong_store_when_a_200_is_not_from_this_platform(monkeypatch):
    """Somebody else's server answering 200 is not a healthy domain."""
    responder(monkeypatch, lambda r: httpx.Response(200, json={"hello": "world"}))
    assert run_probe().status == dh.WRONG_STORE
    responder(monkeypatch, lambda r: httpx.Response(200, text="<html>parked domain</html>"))
    assert run_probe().status == dh.WRONG_STORE


def test_wrong_store_when_the_platform_knows_no_store_here(monkeypatch):
    responder(monkeypatch, lambda r: httpx.Response(200, json={"platform": dh.PLATFORM, "store": None}))
    result = run_probe()
    assert result.status == dh.WRONG_STORE
    assert "no store is mapped" in result.detail


def test_unreachable_on_dns_or_connection_failure(monkeypatch):
    def refused(request):
        raise httpx.ConnectError("[Errno 111] Connection refused")

    responder(monkeypatch, refused)
    result = run_probe()
    assert result.status == dh.UNREACHABLE
    assert result.http_status is None
    assert "ConnectError" in result.detail


def test_unreachable_on_timeout(monkeypatch):
    def slow(request):
        raise httpx.ConnectTimeout("timed out")

    responder(monkeypatch, slow)
    result = run_probe()
    assert result.status == dh.UNREACHABLE
    assert "within" in result.detail


def test_tls_error_is_told_apart_from_unreachable(monkeypatch):
    def bad_cert(request):
        raise httpx.ConnectError("certificate verify failed") from ssl.SSLCertVerificationError(
            "hostname 'shop.example.com' doesn't match"
        )

    responder(monkeypatch, bad_cert)
    result = run_probe()
    assert result.status == dh.TLS_ERROR
    assert "handshake" in result.detail


def test_http_error_carries_the_status_code(monkeypatch):
    responder(monkeypatch, lambda r: httpx.Response(502, text="bad gateway"))
    result = run_probe()
    assert result.status == dh.HTTP_ERROR
    assert result.http_status == 502
    assert "502" in result.detail


def test_draft_store_that_answers_is_not_published_not_ok(monkeypatch):
    """The domain is fine; the store simply is not serving customers yet."""
    responder(monkeypatch, lambda r: httpx.Response(200, json=body(active=False)))
    result = run_probe(is_active=False)
    assert result.status == dh.NOT_PUBLISHED
    assert result.http_status == 200
    assert result.reached_store_slug == "myshop"


def test_live_page_beats_a_stale_local_row(monkeypatch):
    """Our row says draft, the store it reaches says it is live: believe the
    page, which is what a customer would get."""
    responder(monkeypatch, lambda r: httpx.Response(200, json=body(active=True)))
    assert run_probe(is_active=False).status == dh.OK
    # And the other way round.
    responder(monkeypatch, lambda r: httpx.Response(200, json=body(active=False)))
    assert run_probe(is_active=True).status == dh.NOT_PUBLISHED


def test_classify_falls_back_to_our_row_when_the_page_says_nothing():
    """A platform too old to report `active` still gets the right pill."""
    older = {"platform": dh.PLATFORM, "store": {"id": STORE_ID, "slug": "myshop"}}
    assert dh.classify(older, 200, STORE_ID, True).status == dh.OK
    assert dh.classify(older, 200, STORE_ID, False).status == dh.NOT_PUBLISHED


# --- caching and fan-out -----------------------------------------------------


def test_results_are_cached_for_a_minute_and_refresh_forces_a_probe(monkeypatch):
    seen = responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    domains = [("shop.example.com", True)]

    first = asyncio.run(dh.check(STORE_ID, True, domains))
    assert [d.status for d in first] == [dh.OK]
    assert len(seen) == 1

    # A second list render inside the TTL costs nothing.
    again = asyncio.run(dh.check(STORE_ID, True, domains))
    assert [d.status for d in again] == [dh.OK]
    assert len(seen) == 1

    # The row's refresh button goes back to the network.
    asyncio.run(dh.check(STORE_ID, True, domains, refresh=True))
    assert len(seen) == 2


def test_cache_expires(monkeypatch):
    seen = responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    now = [1000.0]
    monkeypatch.setattr(dh.time, "monotonic", lambda: now[0])
    domains = [("shop.example.com", True)]

    asyncio.run(dh.check(STORE_ID, True, domains))
    now[0] += dh.CACHE_TTL_SECONDS - 1
    asyncio.run(dh.check(STORE_ID, True, domains))
    assert len(seen) == 1
    now[0] += 2
    asyncio.run(dh.check(STORE_ID, True, domains))
    assert len(seen) == 2


def test_cache_is_per_store_and_per_host(monkeypatch):
    responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    asyncio.run(dh.check(STORE_ID, True, [("shop.example.com", True)]))
    # Another store on the same hostname must not read this store's answer.
    assert dh._cache.get((STORE_ID + 1, "shop.example.com")) is None
    assert dh._cache.get((STORE_ID, "www.example.com")) is None


def test_every_domain_of_the_store_is_probed_and_nothing_else(monkeypatch):
    seen = responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    results = asyncio.run(
        dh.check(
            STORE_ID,
            True,
            [("shop.example.com", True), ("www.shop.example.com", False)],
        )
    )
    assert [d.host for d in results] == ["shop.example.com", "www.shop.example.com"]
    assert [d.is_primary for d in results] == [True, False]
    assert {r.url.host for r in seen} == {"shop.example.com", "www.shop.example.com"}


def test_a_store_with_no_domains_probes_nothing(monkeypatch):
    seen = responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    assert asyncio.run(dh.check(STORE_ID, True, [])) == []
    assert seen == []


def test_one_failing_domain_does_not_hide_a_healthy_one(monkeypatch):
    def per_host(request: httpx.Request) -> httpx.Response:
        if request.url.host == "old.example.com":
            raise httpx.ConnectError("no such host")
        return httpx.Response(200, json=body())

    responder(monkeypatch, per_host)
    results = asyncio.run(
        dh.check(STORE_ID, True, [("shop.example.com", True), ("old.example.com", False)])
    )
    assert [d.status for d in results] == [dh.OK, dh.UNREACHABLE]


# --- the endpoints -----------------------------------------------------------


def _store(store_id=STORE_ID, active=True, hosts=(("shop.example.com", True),)):
    return SimpleNamespace(
        id=store_id,
        slug="myshop",
        name="My Shop",
        is_active=active,
        domains=[SimpleNamespace(host=h, is_primary=p) for h, p in hosts],
    )


def _user(uid=1, role=UserRole.staff):
    return SimpleNamespace(id=uid, email="x@example.com", role=role)


def _config(host="shop.example.com"):
    return StoreConfig(
        id=STORE_ID,
        slug="myshop",
        name="My Shop",
        template="classic",
        currency="BDT",
        host=host,
    )


def _client(monkeypatch, store, *, signed_in=None, members=None):
    """The two new routes on a bare app, no database. `members` is
    {user id: {store id: role}}; `store` is the only store that exists."""
    members = members or {}

    async def fake_404(session, store_id):
        if store is None or store_id != store.id:
            raise HTTPException(status_code=404, detail="Store not found")
        return store

    async def fake_role(session, user_id, store_id):
        return members.get(user_id, {}).get(store_id)

    monkeypatch.setattr(stores_router, "_get_or_404", fake_404)
    monkeypatch.setattr(tenancy, "membership_role", fake_role)

    app = FastAPI()
    app.include_router(stores_router.health_router, prefix="/api")
    app.include_router(stores_router.check_router, prefix="/api")
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[get_current_user] = lambda: signed_in or _user()
    return TestClient(app)


def _resolves_to(monkeypatch, value):
    """What /api/store-check's hostname lookup finds."""

    async def resolve(session, host):
        return value

    monkeypatch.setattr(stores_mod, "resolve_host_any", resolve)


def test_health_endpoint_reports_every_domain(monkeypatch):
    responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    store = _store(hosts=(("shop.example.com", True), ("old.example.com", False)))
    client = _client(monkeypatch, store, signed_in=_user(role=UserRole.super_admin))

    res = client.get(f"/api/stores/{STORE_ID}/health")
    assert res.status_code == 200
    payload = res.json()
    assert payload["store_id"] == STORE_ID and payload["is_active"] is True
    assert [d["host"] for d in payload["domains"]] == [
        "shop.example.com",
        "old.example.com",
    ]
    assert payload["domains"][0]["status"] == dh.OK
    assert payload["domains"][0]["is_primary"] is True
    assert payload["domains"][0]["reached_store_slug"] == "myshop"


def test_health_is_open_to_the_stores_own_staff_and_closed_to_others(monkeypatch):
    responder(monkeypatch, lambda r: httpx.Response(200, json=body()))
    store = _store()

    client = _client(
        monkeypatch, store, signed_in=_user(uid=5), members={5: {STORE_ID: "staff"}}
    )
    assert client.get(f"/api/stores/{STORE_ID}/health").status_code == 200

    client = _client(monkeypatch, store, signed_in=_user(uid=6))
    assert client.get(f"/api/stores/{STORE_ID}/health").status_code == 403

    client = _client(monkeypatch, None, signed_in=_user(uid=6))
    assert client.get(f"/api/stores/{STORE_ID}/health").status_code == 404


def test_health_of_a_draft_store_that_answers(monkeypatch):
    """The "reachable, but not published" pill, end to end."""
    responder(monkeypatch, lambda r: httpx.Response(200, json=body(active=False)))
    client = _client(
        monkeypatch, _store(active=False), signed_in=_user(role=UserRole.super_admin)
    )

    payload = client.get(f"/api/stores/{STORE_ID}/health").json()
    # Both facts, side by side: our row says draft, and so does the live page.
    assert payload["is_active"] is False
    assert payload["domains"][0]["status"] == dh.NOT_PUBLISHED


def test_store_check_names_the_store_it_resolved(monkeypatch):
    """The probe's whole basis: a 200 that says which store answered."""
    client = _client(monkeypatch, _store())
    _resolves_to(monkeypatch, (_config(), True))

    res = client.get("/api/store-check", headers={"x-store-host": "shop.example.com"})
    assert res.status_code == 200
    assert res.json() == {
        "platform": dh.PLATFORM,
        "store": {"id": STORE_ID, "slug": "myshop", "name": "My Shop", "active": True},
    }
    # And it is exactly what a probe reads as healthy.
    assert dh.classify(res.json(), 200, STORE_ID, True).status == dh.OK


def test_store_check_on_an_unmapped_hostname(monkeypatch):
    client = _client(monkeypatch, _store())
    _resolves_to(monkeypatch, None)

    res = client.get("/api/store-check", headers={"x-store-host": "nobody.example.com"})
    # Still ours, still 200: "this platform answers, no store lives here".
    assert res.json() == {"platform": dh.PLATFORM, "store": None}
    assert dh.classify(res.json(), 200, STORE_ID, True).status == dh.WRONG_STORE


def test_store_check_reports_a_draft_store(monkeypatch):
    client = _client(monkeypatch, _store())
    _resolves_to(monkeypatch, (_config(), False))

    res = client.get("/api/store-check", headers={"x-store-host": "shop.example.com"})
    assert res.json()["store"]["active"] is False
    assert dh.classify(res.json(), 200, STORE_ID, False).status == dh.NOT_PUBLISHED
