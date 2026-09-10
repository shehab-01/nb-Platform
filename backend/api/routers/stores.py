"""Stores: the public read a storefront needs, the signed-in user's own store
list, and the platform admin's CRUD.

Three routers, three gates. `router` (/storefront) is public. `me_router`
(/me) needs a signed-in, approved user. `admin_router` (/stores) is super
admin only: creating and editing stores is the platform's business, no store
role reaches it."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores, tenancy
from api.auth import get_current_user, require_super_admin
from api.config import settings
from api.db import get_session
from api.models import Store, StoreDomain, User
from api.schemas import (
    StoreAccessOut,
    StoreConfigOut,
    StoreCreate,
    StoreDirectoryEntry,
    StoreOut,
    StoreUpdate,
)

router = APIRouter(prefix="/storefront", tags=["Storefront"])
me_router = APIRouter(prefix="/me", tags=["Me"])
admin_router = APIRouter(
    prefix="/stores", tags=["Stores"], dependencies=[Depends(require_super_admin)]
)

# The templates the web app knows. Mirrored here so a store can never be
# saved pointing at a component set that does not exist. Keep in step with
# frontend/src/templates/index.ts.
TEMPLATES = ("classic", "campaign")


# --- public ------------------------------------------------------------------


@router.get("/config", response_model=StoreConfigOut)
async def storefront_config(
    store: stores.StoreConfig = Depends(stores.current_store),
    session: AsyncSession = Depends(get_session),
) -> StoreConfigOut:
    """The store resolved from this request's hostname (404 when none)."""
    return StoreConfigOut(
        id=store.id,
        slug=store.slug,
        name=store.name,
        template=store.template,
        currency=store.currency,
        theme=store.theme,
        content=store.content,
        host=store.host,
        domains=list(store.domains),
        meta_pixel_id=(await stores.load_integrations(session, store.id) or stores.Integrations(
            store_id=store.id, order_prefix=store.order_prefix, meta=stores.MetaConfig(), pathao=stores.PathaoConfig()
        )).meta.pixel_id,
        order_prefix=store.order_prefix,
    )


@router.get("/directory", response_model=list[StoreDirectoryEntry])
async def storefront_directory(
    session: AsyncSession = Depends(get_session),
) -> list[StoreDirectoryEntry]:
    """Every active store and its domains. Development only: it is what the
    "no store at this address" page lists so the seeded stores are one click
    away. Empty in production, where a wrong hostname should learn nothing."""
    if not settings.dev_store_fallback:
        return []
    rows = await session.scalars(
        select(Store).where(Store.is_active.is_(True)).order_by(Store.id)
    )
    return [
        StoreDirectoryEntry(
            slug=s.slug, name=s.name, domains=[d.host for d in s.domains]
        )
        for s in rows
    ]


# --- me ----------------------------------------------------------------------


@me_router.get("/stores", response_model=list[StoreAccessOut])
async def my_stores(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[StoreAccessOut]:
    """The stores this user may open — what the admin's store switcher lists.
    Empty for an approved user with no memberships, who then sees only the
    waiting page."""
    return [
        StoreAccessOut(store_id=a.store_id, slug=a.slug, name=a.name, role=a.role)
        for a in await tenancy.accessible_stores(session, user)
    ]


# --- platform admin ----------------------------------------------------------


def _out(store: Store) -> StoreOut:
    domains = [d.host for d in store.domains]
    primary = next((d.host for d in store.domains if d.is_primary), None)
    return StoreOut(
        id=store.id,
        slug=store.slug,
        name=store.name,
        template=store.template,
        currency=store.currency,
        order_prefix=store.order_prefix,
        theme=store.theme or {},
        is_active=store.is_active,
        domains=domains,
        primary_domain=primary or (domains[0] if domains else None),
        created_at=store.created_at,
        updated_at=store.updated_at,
    )


async def _get_or_404(session: AsyncSession, store_id: int) -> Store:
    store = await session.get(Store, store_id)
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found")
    return store


async def _reload(session: AsyncSession, store_id: int) -> Store:
    session.expire_all()
    return await _get_or_404(session, store_id)


async def _check_prefix(session: AsyncSession, prefix: str, own_id: int | None) -> None:
    """Order numbers must name one store: refuse a prefix another store has."""
    taken = await session.scalar(
        select(Store.name).where(Store.order_prefix == prefix, Store.id != (own_id or 0))
    )
    if taken:
        raise HTTPException(
            status_code=409, detail=f"Order prefix {prefix} is already used by {taken}"
        )


def _check_template(name: str) -> None:
    if name not in TEMPLATES:
        raise HTTPException(
            status_code=400, detail=f"Unknown template {name!r}; one of {', '.join(TEMPLATES)}"
        )


async def _set_domains(session: AsyncSession, store: Store, hosts: list[str]) -> None:
    """Make the store's domains exactly `hosts`, the first being primary. A
    hostname another store owns is refused: two stores cannot answer on one
    address."""
    taken = await session.execute(
        select(StoreDomain.host, StoreDomain.store_id).where(
            StoreDomain.host.in_(hosts), StoreDomain.store_id != store.id
        )
    )
    clash = [row.host for row in taken]
    if clash:
        raise HTTPException(
            status_code=409, detail=f"Already used by another store: {', '.join(clash)}"
        )
    existing = {
        d.host: d
        for d in (
            await session.scalars(
                select(StoreDomain).where(StoreDomain.store_id == store.id)
            )
        ).all()
    }
    for host, row in existing.items():
        if host not in hosts:
            await session.delete(row)
        else:
            row.is_primary = False
    await session.flush()
    for i, host in enumerate(hosts):
        row = existing.get(host)
        if row is None:
            row = StoreDomain(store_id=store.id, host=host)
            session.add(row)
        row.is_primary = i == 0
    await session.flush()


@admin_router.get("", response_model=list[StoreOut])
async def list_stores(session: AsyncSession = Depends(get_session)) -> list[StoreOut]:
    rows = await session.scalars(select(Store).order_by(Store.id))
    return [_out(s) for s in rows]


@admin_router.get("/templates", response_model=list[str])
async def list_templates() -> list[str]:
    return list(TEMPLATES)


@admin_router.post("", response_model=StoreOut, status_code=201)
async def create_store(
    payload: StoreCreate, session: AsyncSession = Depends(get_session)
) -> StoreOut:
    _check_template(payload.template)
    if await session.scalar(select(Store.id).where(Store.slug == payload.slug)):
        raise HTTPException(status_code=409, detail="Slug already in use")
    await _check_prefix(session, payload.order_prefix, None)
    store = Store(
        slug=payload.slug,
        name=payload.name,
        order_prefix=payload.order_prefix,
        template=payload.template,
        currency=payload.currency,
        theme=payload.theme,
        is_active=payload.is_active,
        domains=[],
    )
    session.add(store)
    await session.flush()
    await _set_domains(session, store, payload.domains)
    await session.commit()
    stores.invalidate()
    return _out(await _reload(session, store.id))


@admin_router.patch("/{store_id}", response_model=StoreOut)
async def update_store(
    store_id: int, payload: StoreUpdate, session: AsyncSession = Depends(get_session)
) -> StoreOut:
    store = await _get_or_404(session, store_id)
    if payload.name is not None:
        store.name = payload.name
    if payload.order_prefix is not None and payload.order_prefix != store.order_prefix:
        await _check_prefix(session, payload.order_prefix, store.id)
        store.order_prefix = payload.order_prefix
    if payload.template is not None:
        _check_template(payload.template)
        store.template = payload.template
    if payload.currency is not None:
        store.currency = payload.currency.upper()
    if payload.theme is not None:
        store.theme = payload.theme
    if payload.is_active is not None:
        store.is_active = payload.is_active
    if payload.domains is not None:
        await _set_domains(session, store, payload.domains)
    await session.commit()
    stores.invalidate()
    return _out(await _reload(session, store_id))
