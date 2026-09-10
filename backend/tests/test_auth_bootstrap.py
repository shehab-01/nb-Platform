"""SUPER_ADMIN_EMAILS bootstrap: the first Google sign-in of a listed address
becomes an active super admin; anyone else is pending and blocked.
Run from backend/: pytest -q"""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.auth import get_current_user, get_session_user
from api.config import settings
from api.db import get_session
from api.models import User, UserRole, UserStatus
from api.routers import auth as auth_router


class FakeSession:
    """Just enough of AsyncSession for login_with_google on an empty users table."""

    def __init__(self):
        self.users: list[User] = []

    async def scalar(self, stmt):
        return None  # no user yet

    def add(self, obj):
        # What the database would fill in on insert.
        obj.id = len(self.users) + 1
        obj.created_at = datetime.now(timezone.utc)
        self.users.append(obj)

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass


@pytest.fixture
def make_client(monkeypatch):
    def factory(super_admins: set[str], claims: dict):
        monkeypatch.setattr(settings, "google_client_id", "cid")
        monkeypatch.setattr(settings, "super_admin_emails", frozenset(super_admins))
        monkeypatch.setattr(auth_router, "_verify_google_token", lambda cred: claims)
        fake = FakeSession()

        async def fake_session():
            yield fake

        app = FastAPI()
        app.dependency_overrides[get_session] = fake_session
        app.include_router(auth_router.router, prefix="/api")

        @app.get("/guarded")
        async def guarded(user: User = Depends(get_current_user)):
            return {"email": user.email}

        client = TestClient(app)
        client.fake = fake  # type: ignore[attr-defined]
        return client

    return factory


def test_listed_email_becomes_active_super_admin_on_fresh_db(make_client):
    client = make_client(
        {"boss@example.com"},
        {"email": "Boss@Example.com", "email_verified": True, "name": "Boss"},
    )
    res = client.post("/api/auth/google", json={"credential": "x"})
    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "super_admin" and body["status"] == "active"
    assert "nb_session" in res.cookies
    user = client.fake.users[0]
    assert user.role == UserRole.super_admin and user.status == UserStatus.active


def test_unlisted_email_is_pending(make_client):
    client = make_client(
        {"boss@example.com"},
        {"email": "new@example.com", "email_verified": True, "name": "New"},
    )
    body = client.post("/api/auth/google", json={"credential": "x"}).json()
    assert body["role"] == "staff" and body["status"] == "pending"


def test_unverified_email_is_refused(make_client):
    client = make_client({}, {"email": "x@example.com", "email_verified": False})
    assert client.post("/api/auth/google", json={"credential": "x"}).status_code == 401


def test_pending_user_is_blocked_by_get_current_user():
    pending = SimpleNamespace(id=5, email="p@example.com", role=UserRole.staff, status=UserStatus.pending)

    async def fake_session_user():
        return pending

    app = FastAPI()
    app.dependency_overrides[get_session_user] = fake_session_user

    @app.get("/guarded")
    async def guarded(user: User = Depends(get_current_user)):
        return {"ok": True}

    res = TestClient(app).get("/guarded")
    assert res.status_code == 403
    assert "pending" in res.json()["detail"]
