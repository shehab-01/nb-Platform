"""Is a store's domain actually serving?

The Stores list shows two different things that are easy to confuse: the
store's row in our database (`is_active` — "Active" in the admin) and whether
the hostname customers type really reaches this platform and lands on *this*
store. A store can be Active with its DNS still pointing at the old host, and
a perfectly published domain can belong to a draft store. This module answers
the second question.

The probe is a plain GET of https://<host>/api/store-check, the route the
platform answers on every storefront hostname (api.routers.stores). Its body
names the store the hostname resolved to, so a 200 alone is never taken as
success: the answer has to come from this platform *and* name this store.

Only hostnames read from store_domains for the store being checked are ever
probed — nothing in a request decides what gets fetched. Results are cached
per (store, host) for CACHE_TTL_SECONDS so a list render costs at most one
request per domain per minute.
"""
from __future__ import annotations

import asyncio
import ssl
import time
from dataclasses import dataclass

import httpx

CHECK_PATH = "/api/store-check"
# Short on purpose: the admin list waits on these, and a domain that needs
# longer than this to answer is a problem worth showing anyway.
TIMEOUT_SECONDS = 4.0
CACHE_TTL_SECONDS = 60.0
USER_AGENT = "nbPlatform-domain-check/1.0"
# The marker /api/store-check puts in its body, so a 200 from somebody else's
# server is not mistaken for one of ours.
PLATFORM = "nbplatform"

# Tests inject an httpx.MockTransport here; production leaves it None.
transport: httpx.AsyncBaseTransport | None = None

# What a probe concluded. Green: OK. Amber: NOT_PUBLISHED, WRONG_STORE.
# Red: UNREACHABLE, TLS_ERROR, HTTP_ERROR.
OK = "ok"
WRONG_STORE = "wrong_store"
NOT_PUBLISHED = "not_published"
UNREACHABLE = "unreachable"
TLS_ERROR = "tls_error"
HTTP_ERROR = "http_error"


@dataclass(frozen=True)
class Probe:
    """What one HTTPS request to one hostname found."""

    status: str
    detail: str
    http_status: int | None = None
    #: The store the hostname actually answered for, when it named one.
    reached_store_id: int | None = None
    reached_store_slug: str | None = None


@dataclass(frozen=True)
class DomainHealth:
    """One of the store's hostnames, as the admin shows it."""

    host: str
    is_primary: bool
    #: The hostname is in store_domains at all (it is, for a store's own
    #: domains — kept explicit because the admin distinguishes "we do not
    #: know this name" from "it does not answer").
    resolved: bool
    resolved_store_id: int | None
    status: str
    detail: str
    http_status: int | None = None
    reached_store_slug: str | None = None


def _is_tls_error(exc: BaseException) -> bool:
    """A failed handshake rather than a refused or missing connection. httpx
    reports both as ConnectError, so the cause chain is what tells them
    apart."""
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, ssl.SSLError):
            return True
        cur = cur.__cause__ or cur.__context__
    return False


def classify(
    body: object, http_status: int, store_id: int, is_active: bool
) -> Probe:
    """What an answered request means for this store.

    `body` is whatever /api/store-check returned (None when it was not JSON).
    A draft store that answers correctly is NOT_PUBLISHED, not OK: the domain
    works, there is simply nothing to sell there yet.
    """
    if http_status >= 300 or http_status < 200:
        return Probe(
            HTTP_ERROR,
            f"The domain answered HTTP {http_status}.",
            http_status=http_status,
        )
    if not isinstance(body, dict) or body.get("platform") != PLATFORM:
        return Probe(
            WRONG_STORE,
            "The domain answers, but not from this platform — it points somewhere else.",
            http_status=http_status,
        )
    reached = body.get("store")
    if not isinstance(reached, dict):
        return Probe(
            WRONG_STORE,
            "This platform answers here, but no store is mapped to this hostname.",
            http_status=http_status,
        )
    reached_id = reached.get("id")
    reached_slug = reached.get("slug")
    reached_id = int(reached_id) if isinstance(reached_id, int) else None
    reached_slug = str(reached_slug) if reached_slug else None
    if reached_id != store_id:
        return Probe(
            WRONG_STORE,
            f"This hostname serves {reached_slug or 'another store'}, not this store.",
            http_status=http_status,
            reached_store_id=reached_id,
            reached_store_slug=reached_slug,
        )
    # The live page is the authority on whether it is published; the local row
    # is the fallback for a platform too old to report it.
    live_active = reached.get("active")
    active = bool(live_active) if isinstance(live_active, bool) else is_active
    if not active:
        return Probe(
            NOT_PUBLISHED,
            "The domain reaches this store, but the store is not active — customers see nothing.",
            http_status=http_status,
            reached_store_id=reached_id,
            reached_store_slug=reached_slug,
        )
    return Probe(
        OK,
        "Serving this store.",
        http_status=http_status,
        reached_store_id=reached_id,
        reached_store_slug=reached_slug,
    )


async def probe(host: str, store_id: int, is_active: bool) -> Probe:
    """One HTTPS request to one of this store's hostnames. Never raises."""
    url = f"https://{host}{CHECK_PATH}"
    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS, transport=transport, follow_redirects=True
        ) as client:
            res = await client.get(url, headers={"user-agent": USER_AGENT})
    except httpx.TimeoutException:
        return Probe(
            UNREACHABLE, f"No answer within {TIMEOUT_SECONDS:g}s."
        )
    except httpx.HTTPError as exc:
        if _is_tls_error(exc):
            return Probe(TLS_ERROR, f"HTTPS handshake failed: {_reason(exc)}")
        return Probe(UNREACHABLE, f"Could not connect: {_reason(exc)}")
    try:
        body: object = res.json()
    except ValueError:
        body = None
    return classify(body, res.status_code, store_id, is_active)


def _reason(exc: BaseException) -> str:
    """A short line for the admin's tooltip. The exception type carries the
    useful part (ConnectError, ConnectTimeout); its message can be a whole
    certificate chain, so it is trimmed."""
    text = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return f"{type(exc).__name__}{f' — {text[:120]}' if text else ''}"


class _Cache:
    """(store id, host) -> (expires_at, DomainHealth). Small, bounded, and
    per worker: a stale-by-a-minute answer is the point."""

    def __init__(self, ttl: float) -> None:
        self.ttl = ttl
        self._entries: dict[tuple[int, str], tuple[float, DomainHealth]] = {}

    def get(self, key: tuple[int, str]) -> DomainHealth | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= time.monotonic():
            del self._entries[key]
            return None
        return value

    def put(self, key: tuple[int, str], value: DomainHealth) -> None:
        if len(self._entries) >= 5_000:
            self._entries.clear()
        self._entries[key] = (time.monotonic() + self.ttl, value)

    def clear(self) -> None:
        self._entries.clear()


_cache = _Cache(CACHE_TTL_SECONDS)


def invalidate() -> None:
    _cache.clear()


async def check(
    store_id: int,
    is_active: bool,
    domains: list[tuple[str, bool]],
    *,
    refresh: bool = False,
) -> list[DomainHealth]:
    """Every hostname of one store, probed at once (or served from cache).

    `domains` is (host, is_primary) read from store_domains by the caller —
    the only source of hostnames this module accepts.
    """
    cached = {
        host: None if refresh else _cache.get((store_id, host)) for host, _ in domains
    }
    todo = [(host, primary) for host, primary in domains if cached[host] is None]
    fresh = await asyncio.gather(
        *(probe(host, store_id, is_active) for host, _ in todo)
    )
    for (host, primary), result in zip(todo, fresh):
        health = DomainHealth(
            host=host,
            is_primary=primary,
            # The caller only ever passes this store's own rows, so the
            # hostname is in store_domains by construction.
            resolved=True,
            resolved_store_id=store_id,
            status=result.status,
            detail=result.detail,
            http_status=result.http_status,
            reached_store_slug=result.reached_store_slug,
        )
        cached[host] = health
        _cache.put((store_id, host), health)
    # Primary first, then the aliases in the order the store lists them.
    return [cached[host] for host, _ in domains if cached[host] is not None]
