"""
api.tenancy: who may open which store.

The membership and store lookups are monkeypatched so these run without a
database, the way the rest of the suite does. What is under test is the rule:
pending users blocked, X-Admin-Store checked against memberships, super admin
bypass, and the switcher list containing only assigned stores.

Run from backend/:  python -m pytest tests -q
"""
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api import stores, tenancy
from api.auth import get_session_user
from api.db import get_session
from api.models import UserRole, UserStatus
from api.routers.store_settings import settings_store
from api.routers.stores import me_router
from api.stores import StoreConfig


def user(role=UserRole.staff, status=UserStatus.active, uid=7):
    return SimpleNamespace(id=uid, email="x@example.com", role=role, status=status)


STORE_A = StoreConfig(id=1, slug="a", name="A", template="classic", currency="BDT")
STORE_B = StoreConfig(id=2, slug="b", name="B", template="classic", currency="BDT")
ALL = [
    tenancy.StoreAccess(1, "a", "A", "", True),
    tenancy.StoreAccess(2, "b", "B", "", True),
    tenancy.StoreAccess(3, "c", "C", "", False),  # inactive
]


@pytest.fixture
def app(monkeypatch):
    """A tiny app: one store-scoped route, one write-gated route, and
    /api/me/stores. `who` swaps the signed-in user; `members` is the
    membership table (user id -> {store id: role})."""
    state = {"user": user(), "members": {}}

    async def fake_session():
        yield None

    async def fake_session_user():
        return state["user"]

    async def fake_resolve_id(session, store_id):
        return {1: STORE_A, 2: STORE_B}.get(store_id)

    async def fake_membership_role(session, user_id, store_id):
        return state["members"].get(user_id, {}).get(store_id)

    async def fake_load_memberships(session, user_id):
        return [
            tenancy.StoreAccess(s.store_id, s.slug, s.name, role, s.is_active)
            for s in ALL
            for sid, role in state["members"].get(user_id, {}).items()
            if s.store_id == sid
        ]

    async def fake_load_all(session):
        return ALL

    monkeypatch.setattr(stores, "resolve_id", fake_resolve_id)
    monkeypatch.setattr(tenancy, "membership_role", fake_membership_role)
    monkeypatch.setattr(tenancy, "load_memberships", fake_load_memberships)
    monkeypatch.setattr(tenancy, "load_all_stores", fake_load_all)

    app = FastAPI()
    app.dependency_overrides[get_session] = fake_session
    app.dependency_overrides[get_session_user] = fake_session_user

    @app.get("/scoped")
    async def scoped(ctx: tenancy.StoreContext = Depends(tenancy.admin_store)):
        return {"store": ctx.store.slug, "role": ctx.role}

    @app.post("/write", dependencies=[Depends(tenancy.require("catalogue.write"))])
    async def write():
        return {"ok": True}

    @app.get("/stores/{store_id}/settings-gate")
    async def gate(ctx: tenancy.StoreContext = Depends(settings_store)):
        return {"store": ctx.store.slug}

    app.include_router(me_router, prefix="/api")
    client = TestClient(app)
    client.state = state  # type: ignore[attr-defined]
    return client


def get(client, path, store=None, **kw):
    headers = {}
    if store is not None:
        headers[tenancy.ADMIN_STORE_HEADER] = str(store)
    return client.get(path, headers=headers, **kw)


# --- pending users are blocked everywhere --------------------------------------


def test_pending_user_cannot_open_a_store(app):
    app.state["user"] = user(status=UserStatus.pending)
    app.state["members"] = {7: {1: "owner"}}
    assert get(app, "/scoped", store=1).status_code == 403
    assert get(app, "/api/me/stores").status_code == 403


def test_suspended_user_is_blocked_too(app):
    app.state["user"] = user(status=UserStatus.suspended)
    assert get(app, "/api/me/stores").status_code == 403


# --- X-Admin-Store is checked against memberships ------------------------------


def test_header_is_required(app):
    app.state["members"] = {7: {1: "staff"}}
    res = get(app, "/scoped")
    assert res.status_code == 400
    assert get(app, "/scoped", store="abc").status_code == 400


def test_member_gets_in_with_their_role(app):
    app.state["members"] = {7: {1: "staff"}}
    res = get(app, "/scoped", store=1)
    assert res.status_code == 200
    assert res.json() == {"store": "a", "role": "staff"}


def test_non_member_is_refused(app):
    app.state["members"] = {7: {1: "staff"}}
    assert get(app, "/scoped", store=2).status_code == 403


def test_unknown_store_is_404_even_for_members(app):
    app.state["members"] = {7: {9: "owner"}}
    assert get(app, "/scoped", store=9).status_code == 404


def test_role_permissions_are_enforced(app):
    app.state["members"] = {7: {1: "staff"}}
    assert app.post("/write", headers={tenancy.ADMIN_STORE_HEADER: "1"}).status_code == 403
    app.state["members"] = {7: {1: "manager"}}
    assert app.post("/write", headers={tenancy.ADMIN_STORE_HEADER: "1"}).status_code == 200


# --- super admin bypass --------------------------------------------------------


def test_super_admin_opens_any_active_store_without_membership(app):
    app.state["user"] = user(role=UserRole.super_admin)
    app.state["members"] = {}
    res = get(app, "/scoped", store=2)
    assert res.status_code == 200
    assert res.json() == {"store": "b", "role": "super_admin"}
    assert app.post("/write", headers={tenancy.ADMIN_STORE_HEADER: "2"}).status_code == 200


# --- the switcher lists only assigned stores ----------------------------------


def test_my_stores_lists_only_memberships(app):
    app.state["members"] = {7: {2: "manager"}, 8: {1: "owner"}}
    res = get(app, "/api/me/stores")
    assert res.status_code == 200
    assert res.json() == [{"store_id": 2, "slug": "b", "name": "B", "role": "manager"}]


def test_my_stores_is_empty_with_no_memberships(app):
    app.state["members"] = {}
    assert get(app, "/api/me/stores").json() == []


def test_my_stores_hides_inactive_stores(app):
    app.state["members"] = {7: {3: "owner", 1: "staff"}}
    assert [s["store_id"] for s in get(app, "/api/me/stores").json()] == [1]


def test_super_admin_sees_every_active_store(app):
    app.state["user"] = user(role=UserRole.super_admin)
    rows = get(app, "/api/me/stores").json()
    assert [(s["store_id"], s["role"]) for s in rows] == [
        (1, "super_admin"),
        (2, "super_admin"),
    ]


# --- the pure rule -------------------------------------------------------------


def test_accessible_is_pure_and_filters_inactive():
    memberships = [
        tenancy.StoreAccess(1, "a", "A", "staff", True),
        tenancy.StoreAccess(3, "c", "C", "owner", False),
    ]
    assert tenancy.accessible(user(), memberships, ALL) == memberships[:1]
    got = tenancy.accessible(user(role=UserRole.super_admin), [], ALL)
    assert [s.store_id for s in got] == [1, 2]
    assert {s.role for s in got} == {"super_admin"}


def test_permission_table_matches_the_documented_roles():
    ctx = lambda role: tenancy.StoreContext(store=STORE_A, role=role, user=user())  # noqa: E731
    assert ctx("staff").can("orders") and not ctx("staff").can("catalogue.write")
    assert ctx("manager").can("catalogue.write") and not ctx("manager").can("settings")
    assert ctx("owner").can("settings") and ctx("owner").can("members.write")
    assert ctx("super_admin").can("members.write")
    with pytest.raises(ValueError):
        tenancy.require("no-such-permission")


# --- store settings gate --------------------------------------------------------


def test_settings_need_owner_and_matching_header(app):
    h = {tenancy.ADMIN_STORE_HEADER: "1"}
    app.state["members"] = {7: {1: "manager"}}
    assert app.get("/stores/1/settings-gate", headers=h).status_code == 403
    app.state["members"] = {7: {1: "owner"}}
    assert app.get("/stores/1/settings-gate", headers=h).status_code == 200
    # Owner of store 1, but asking for store 2's settings: refused.
    assert app.get("/stores/2/settings-gate", headers=h).status_code == 403


def test_settings_super_admin_edits_any_store_from_the_path(app):
    app.state["user"] = user(role=UserRole.super_admin)
    # From the platform Stores page the switcher may point elsewhere, or
    # nowhere: the path decides for a super admin.
    assert app.get("/stores/2/settings-gate", headers={tenancy.ADMIN_STORE_HEADER: "1"}).status_code == 200
    assert app.get("/stores/2/settings-gate").json() == {"store": "b"}
    assert app.get("/stores/9/settings-gate").status_code == 404
