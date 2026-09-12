"""
Which store a request is for.

The web app (Next.js) puts the hostname the browser asked for in the
X-Store-Host header on every request it proxies to this API. Nothing else is
trusted from the client: the header carries only a hostname, and this module
resolves that hostname against store_domains itself, so a made-up value
resolves to nothing rather than to someone else's store.

Resolution is served from an in-process cache with a short TTL. A page load
fans out into several API calls and every one of them needs the store, so the
lookup has to cost nothing; a rename or a new domain in the admin takes effect
within CACHE_TTL_SECONDS on every worker without any cross-process signalling.

In development, DEV_STORE_FALLBACK=1 additionally accepts X-Store-Slug, which
the web app sets from a ?__store=<slug> query parameter, so the storefronts
can be reached on plain localhost without hostnames. Off in production.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Generic, TypeVar

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import crypto
from api.config import settings
from api.db import get_session
from api.models import Store, StoreDomain, StoreSettings

STORE_HOST_HEADER = "x-store-host"
STORE_SLUG_HEADER = "x-store-slug"
CACHE_TTL_SECONDS = 30.0


@dataclass(frozen=True)
class StoreConfig:
    """The store as the rest of the API and the storefront need it: plain
    values, safe to hold in a cache across requests and sessions."""

    id: int
    slug: str
    name: str
    template: str
    currency: str
    order_prefix: str = "NB"
    theme: dict = field(default_factory=dict)
    # Field key -> public URL of the store's own picture (template default
    # applies for keys not present).
    content: dict = field(default_factory=dict)
    # The hostname the store was resolved from, or its primary domain when it
    # was resolved by slug.
    host: str | None = None
    domains: tuple[str, ...] = ()


def normalise_host(raw: str | None) -> str | None:
    """
    "Store1.NB.local:8090." -> "store1.nb.local". None for an empty or
    unusable value. Ports are dropped because the same store answers on
    whatever port the proxy in front happens to use.
    """
    if not raw:
        return None
    host = raw.strip().lower().split(",")[0].strip()
    if host.startswith("["):
        # IPv6 literal: "[::1]:8090" — keep the address, drop the port.
        host = host[1 : host.find("]")] if "]" in host else host[1:]
    elif host.count(":") == 1:
        host = host.split(":", 1)[0]
    host = host.rstrip(".")
    return host or None


def content_url(value: str) -> str:
    """A content value as the browser fetches it: media paths are served
    under /media by the API (and proxied by the web app)."""
    return value if value.startswith("/") else f"/media/{value}"


def _config(store: Store, host: str | None) -> StoreConfig:
    domains = tuple(d.host for d in store.domains)
    return StoreConfig(
        id=store.id,
        slug=store.slug,
        name=store.name,
        template=store.template,
        currency=store.currency,
        order_prefix=store.order_prefix or "NB",
        theme=dict(store.theme or {}),
        content={k: content_url(v) for k, v in (store.content or {}).items()},
        host=host or (domains[0] if domains else None),
        domains=domains,
    )


T = TypeVar("T")


class _Cache(Generic[T]):
    """host-or-slug -> (expires_at, value-or-None). Negative results are
    cached too, so an unknown hostname being hammered costs one query per TTL,
    not one per request."""

    def __init__(self, ttl: float) -> None:
        self.ttl = ttl
        self._entries: dict[str, tuple[float, T | None]] = {}

    def get(self, key: str) -> tuple[bool, T | None]:
        entry = self._entries.get(key)
        if entry is None:
            return False, None
        expires_at, value = entry
        if expires_at <= time.monotonic():
            del self._entries[key]
            return False, None
        return True, value

    def put(self, key: str, value: T | None) -> None:
        # Bound the table: a scan of random hostnames must not grow memory.
        if len(self._entries) >= 10_000:
            self._entries.clear()
        self._entries[key] = (time.monotonic() + self.ttl, value)

    def clear(self) -> None:
        self._entries.clear()


_by_host: _Cache[StoreConfig] = _Cache(CACHE_TTL_SECONDS)
_by_slug: _Cache[StoreConfig] = _Cache(CACHE_TTL_SECONDS)
_by_id: _Cache[StoreConfig] = _Cache(CACHE_TTL_SECONDS)
# Draft stores included, so /api/store-check can tell a store's own domain
# "you found me, I am just not published yet". Nothing else reads it.
_by_host_any: _Cache[tuple[StoreConfig, bool]] = _Cache(CACHE_TTL_SECONDS)


def invalidate() -> None:
    """Forget every cached resolution (this worker only). Called after a
    store or domain is edited so the change shows up at once here; other
    workers catch up within the TTL."""
    _by_host.clear()
    _by_host_any.clear()
    _by_slug.clear()
    _by_id.clear()
    _integrations.clear()


async def resolve_id(session: AsyncSession, store_id: int) -> StoreConfig | None:
    """The admin's path: a store by id (from X-Admin-Store, after the
    membership check in api.tenancy). Inactive stores resolve to None."""
    key = str(store_id)
    hit, cached = _by_id.get(key)
    if hit:
        return cached
    store = await session.get(Store, store_id)
    config = _config(store, None) if store is not None and store.is_active else None
    _by_id.put(key, config)
    return config


async def resolve_host(session: AsyncSession, raw_host: str | None) -> StoreConfig | None:
    host = normalise_host(raw_host)
    if host is None:
        return None
    hit, cached = _by_host.get(host)
    if hit:
        return cached
    store = await session.scalar(
        select(Store)
        .join(StoreDomain, StoreDomain.store_id == Store.id)
        .where(StoreDomain.host == host, Store.is_active.is_(True))
        .limit(1)
    )
    config = _config(store, host) if store is not None else None
    _by_host.put(host, config)
    return config


async def resolve_host_any(
    session: AsyncSession, raw_host: str | None
) -> tuple[StoreConfig, bool] | None:
    """Like `resolve_host`, but a store that is not active resolves too, with
    its `is_active` alongside. Only the domain check reads this: every
    storefront path keeps using `resolve_host`, where a draft store is nobody
    and a wrong hostname learns nothing.
    """
    host = normalise_host(raw_host)
    if host is None:
        return None
    hit, cached = _by_host_any.get(host)
    if hit:
        return cached
    store = await session.scalar(
        select(Store)
        .join(StoreDomain, StoreDomain.store_id == Store.id)
        .where(StoreDomain.host == host)
        .limit(1)
    )
    value = (_config(store, host), store.is_active) if store is not None else None
    _by_host_any.put(host, value)
    return value


async def resolve_slug(session: AsyncSession, slug: str | None) -> StoreConfig | None:
    slug = (slug or "").strip().lower()
    if not slug:
        return None
    hit, cached = _by_slug.get(slug)
    if hit:
        return cached
    store = await session.scalar(
        select(Store).where(Store.slug == slug, Store.is_active.is_(True)).limit(1)
    )
    config = _config(store, None) if store is not None else None
    _by_slug.put(slug, config)
    return config


def requested_host(request: Request) -> str | None:
    """The hostname the browser asked for, as the web app reported it."""
    return (
        request.headers.get(STORE_HOST_HEADER)
        or request.headers.get("x-forwarded-host")
        or request.headers.get("host")
    )


async def resolve_request(session: AsyncSession, request: Request) -> StoreConfig | None:
    """The store for this request, or None when the hostname is nobody's."""
    if settings.dev_store_fallback:
        slug = request.headers.get(STORE_SLUG_HEADER)
        if slug:
            return await resolve_slug(session, slug)
    return await resolve_host(session, requested_host(request))


async def current_store(
    request: Request, session: AsyncSession = Depends(get_session)
) -> StoreConfig:
    """Dependency for storefront endpoints: 404 when no store answers here."""
    store = await resolve_request(session, request)
    if store is None:
        raise HTTPException(status_code=404, detail="No store at this address")
    return store


# --- integration settings ------------------------------------------------------


@dataclass(frozen=True)
class MetaConfig:
    """What the Conversions API sender needs for one store. Disabled (no
    delivery, no parking) until both pixel id and token are set."""

    pixel_id: str = ""
    access_token: str = ""
    test_event_code: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.pixel_id and self.access_token)


@dataclass(frozen=True)
class PathaoConfig:
    """One store's Pathao merchant credentials and parcel defaults."""

    client_id: str = ""
    client_secret: str = ""
    username: str = ""
    password: str = ""
    store_id: int = 0
    item_type: str = "parcel"
    unit_weight_kg: float = 1.0

    @property
    def enabled(self) -> bool:
        return bool(
            self.client_id and self.client_secret and self.username and self.password and self.store_id
        )


@dataclass(frozen=True)
class Integrations:
    store_id: int
    order_prefix: str
    meta: MetaConfig
    pathao: PathaoConfig
    bdcourier_api_key: str = ""


_integrations = _Cache(CACHE_TTL_SECONDS)


def _decrypt(blob: bytes | None) -> str:
    if blob is None or not crypto.available():
        return ""
    try:
        return crypto.decrypt(blob) or ""
    except crypto.InvalidToken:
        return ""


def integrations_from(store: Store, row: StoreSettings | None) -> Integrations:
    """Decrypted, ready to use. Pure apart from decryption, for tests."""
    if row is None:
        return Integrations(
            store_id=store.id, order_prefix=store.order_prefix or "NB",
            meta=MetaConfig(), pathao=PathaoConfig(),
        )
    return Integrations(
        store_id=store.id,
        order_prefix=store.order_prefix or "NB",
        meta=MetaConfig(
            pixel_id=row.meta_pixel_id or "",
            access_token=_decrypt(row.meta_capi_token_enc),
            test_event_code=row.meta_test_event_code or "",
        ),
        pathao=PathaoConfig(
            client_id=row.pathao_client_id or "",
            client_secret=_decrypt(row.pathao_client_secret_enc),
            username=row.pathao_email or "",
            password=_decrypt(row.pathao_password_enc),
            store_id=int(row.pathao_store_id or 0),
            item_type=row.pathao_item_type or "parcel",
            unit_weight_kg=float(row.pathao_parcel_weight_kg or 1),
        ),
        bdcourier_api_key=_decrypt(row.bdcourier_api_key_enc),
    )


async def load_integrations(session: AsyncSession, store_id: int) -> Integrations | None:
    """The store's integration settings, decrypted, cached for the TTL.
    None for an unknown store. Called on order creation, /api/track, Pathao
    bookings and the courier poller — hence the cache."""
    key = str(store_id)
    hit, cached = _integrations.get(key)
    if hit:
        return cached  # type: ignore[return-value]
    store = await session.get(Store, store_id)
    if store is None:
        _integrations.put(key, None)
        return None
    row = await session.get(StoreSettings, store_id)
    value = integrations_from(store, row)
    _integrations.put(key, value)  # type: ignore[arg-type]
    return value


def _invalidate_integrations() -> None:
    _integrations.clear()
