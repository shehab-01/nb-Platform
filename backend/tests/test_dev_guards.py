"""Every development-only switch is off unless its env var is set, and the
features behind them are unreachable then.  Run from backend/: pytest -q"""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import stores
from api.config import settings
from api.db import get_session
from api.routers import auth as auth_router
from api.routers import stores as stores_router
from api.stores import StoreConfig
from scripts.seed_dev import allowed

STORE = StoreConfig(id=1, slug="s1", name="S1", template="classic", currency="BDT")


@pytest.fixture
def app():
    async def fake_session():
        yield None

    app = FastAPI()
    app.dependency_overrides[get_session] = fake_session
    app.include_router(auth_router.router, prefix="/api")
    app.include_router(stores_router.router, prefix="/api")
    return TestClient(app)


def test_dev_login_is_404_when_unset(app, monkeypatch):
    monkeypatch.setattr(settings, "dev_login_email", "")
    assert app.post("/api/auth/dev-login").status_code == 404
    assert app.get("/api/auth/providers").json()["dev"] is False


def test_store_directory_is_empty_when_fallback_off(app, monkeypatch):
    monkeypatch.setattr(settings, "dev_store_fallback", False)
    assert app.get("/api/storefront/directory").json() == []


def test_store_slug_header_is_ignored_when_fallback_off(monkeypatch):
    monkeypatch.setattr(settings, "dev_store_fallback", False)
    seen: list[str] = []

    async def by_host(session, host):
        seen.append(("host", host))
        return None

    async def by_slug(session, slug):
        seen.append(("slug", slug))
        return STORE

    monkeypatch.setattr(stores, "resolve_host", by_host)
    monkeypatch.setattr(stores, "resolve_slug", by_slug)
    request = SimpleNamespace(headers={"x-store-slug": "s1", "x-store-host": "nobody.example"})
    import asyncio

    assert asyncio.run(stores.resolve_request(None, request)) is None
    assert seen == [("host", "nobody.example")]

    monkeypatch.setattr(settings, "dev_store_fallback", True)
    assert asyncio.run(stores.resolve_request(None, request)) is STORE


def test_seed_refuses_outside_development():
    assert not allowed({}, [])
    assert not allowed({"DEV_STORE_FALLBACK": "1"}, [])
    assert not allowed({"DEV_LOGIN_EMAIL": "a@b"}, [])
    assert allowed({"DEV_STORE_FALLBACK": "1", "DEV_LOGIN_EMAIL": "a@b"}, [])
    assert allowed({}, ["--force"])
