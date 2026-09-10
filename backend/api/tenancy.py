"""
Who may work in which store, and as what.

Sign-in is platform-wide (see api.auth); access to a store is a store_users
row with a role, or the platform super_admin role, which sees every store.
The admin UI names the store it is working in with the X-Admin-Store header;
this module turns that header into a StoreContext after checking the user
really has access. Store scoping therefore never comes from the client: the
header is a request, the membership table is the answer.

Roles inside a store, most to least:

  owner    everything in the store: orders, products, store settings (Phase 2),
           and the store's own staff list (assign/remove manager and staff)
  manager  orders and products; may see the store's staff, not change them
  staff    orders only (lists, claim, status, manual order, tags); reads the
           catalogue for the manual order form

A super admin is treated as owner of every store, and additionally reaches the
platform area (Stores, Users) that no store role can.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.auth import get_current_user
from api.db import get_session
from api.models import Store, StoreRole, StoreUser, User, UserRole

ADMIN_STORE_HEADER = "x-admin-store"

# Which roles satisfy each permission. Super admin is implied everywhere.
PERMISSIONS: dict[str, frozenset[str]] = {
    "orders": frozenset({"owner", "manager", "staff"}),
    "catalogue.read": frozenset({"owner", "manager", "staff"}),
    "catalogue.write": frozenset({"owner", "manager"}),
    "settings": frozenset({"owner"}),
    "members.read": frozenset({"owner", "manager"}),
    "members.write": frozenset({"owner"}),
}

ROLE_ORDER = (StoreRole.owner.value, StoreRole.manager.value, StoreRole.staff.value)


@dataclass(frozen=True)
class StoreAccess:
    """One store a user may open, and as what. `role` is "super_admin" for a
    platform super admin, else the membership role."""

    store_id: int
    slug: str
    name: str
    role: str
    is_active: bool = True


@dataclass(frozen=True)
class StoreContext:
    """The store an admin request is working in."""

    store: stores.StoreConfig
    role: str
    user: User

    @property
    def is_super_admin(self) -> bool:
        return self.role == UserRole.super_admin.value

    def can(self, permission: str) -> bool:
        return self.is_super_admin or self.role in PERMISSIONS.get(permission, frozenset())


def is_super_admin(user: User) -> bool:
    return user.role == UserRole.super_admin


def accessible(user: User, memberships: list[StoreAccess], all_stores: list[StoreAccess]) -> list[StoreAccess]:
    """The stores this user may open: every active store for a super admin
    (as "super_admin"), else exactly the active stores they are a member of.
    Pure, so the rule is testable without a database."""
    if is_super_admin(user):
        return [
            StoreAccess(s.store_id, s.slug, s.name, UserRole.super_admin.value, s.is_active)
            for s in all_stores
            if s.is_active
        ]
    return [m for m in memberships if m.is_active]


async def load_memberships(session: AsyncSession, user_id: int) -> list[StoreAccess]:
    rows = await session.execute(
        select(StoreUser.store_id, Store.slug, Store.name, StoreUser.role, Store.is_active)
        .join(Store, Store.id == StoreUser.store_id)
        .where(StoreUser.user_id == user_id)
        .order_by(Store.id)
    )
    return [StoreAccess(*row) for row in rows]


async def load_all_stores(session: AsyncSession) -> list[StoreAccess]:
    rows = await session.execute(
        select(Store.id, Store.slug, Store.name, Store.is_active).order_by(Store.id)
    )
    return [StoreAccess(r.id, r.slug, r.name, "", r.is_active) for r in rows]


async def accessible_stores(session: AsyncSession, user: User) -> list[StoreAccess]:
    if is_super_admin(user):
        return accessible(user, [], await load_all_stores(session))
    return accessible(user, await load_memberships(session, user.id), [])


async def membership_role(session: AsyncSession, user_id: int, store_id: int) -> str | None:
    """The user's role in one store, or None when they are not a member."""
    return await session.scalar(
        select(StoreUser.role).where(
            StoreUser.user_id == user_id, StoreUser.store_id == store_id
        )
    )


def requested_store_id(request: Request) -> int:
    raw = request.headers.get(ADMIN_STORE_HEADER, "").strip()
    if not raw.isdigit():
        raise HTTPException(
            status_code=400, detail="X-Admin-Store header (store id) is required"
        )
    return int(raw)


async def admin_store(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StoreContext:
    """
    Dependency for every store-scoped admin endpoint. 400 without the header,
    404 for a store that does not exist or is inactive, 403 for a user who is
    not a member; super admins pass for any active store.
    """
    store_id = requested_store_id(request)
    store = await stores.resolve_id(session, store_id)
    if store is None:
        raise HTTPException(status_code=404, detail="Unknown store")
    if is_super_admin(user):
        return StoreContext(store=store, role=UserRole.super_admin.value, user=user)
    role = await membership_role(session, user.id, store_id)
    if role is None:
        raise HTTPException(status_code=403, detail="Not a member of this store")
    return StoreContext(store=store, role=role, user=user)


def require(permission: str):
    """Dependency factory: the StoreContext, or 403 when the role lacks the
    permission. `dependencies=[Depends(require("catalogue.write"))]`."""
    if permission not in PERMISSIONS:
        raise ValueError(f"unknown permission {permission!r}")

    async def _check(ctx: StoreContext = Depends(admin_store)) -> StoreContext:
        if not ctx.can(permission):
            raise HTTPException(
                status_code=403, detail=f"Your role in this store cannot do this"
            )
        return ctx

    return _check
