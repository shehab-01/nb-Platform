"""Meta Conversions API: server-side copies of the browser Pixel events.

Every browser event carries an eventID; this module sends the same event from
the server with the same event_id, so Meta deduplicates the pair and still
counts it when the browser copy never arrived (ad blocker, tab closed early).
Purchase uses the order number as the shared id and is sent by the order
endpoint; the other events come in through POST /api/track with a UUID.

Delivery runs as its own asyncio task, detached from the request that produced
the event, with retries on timeouts, connection errors, 5xx and 429. An event
that still cannot be delivered is parked in meta_capi_failed_events for a
resend from Admin → System. Nothing here ever raises into a request handler.

Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.models import MetaCapiFailedEvent
from api.ratelimit import client_ip
from api.stores import MetaConfig

log = logging.getLogger("meta_capi")

CURRENCY = "BDT"
TIMEOUT_SECONDS = 5
# Pauses before each retry, so an event gets 1 + len(RETRY_DELAYS) attempts.
RETRY_DELAYS: tuple[float, ...] = (1.0, 3.0, 9.0)
RETRYABLE_STATUS = frozenset({429} | set(range(500, 600)))

# Tests inject an httpx.MockTransport here; production leaves it None.
transport: httpx.AsyncBaseTransport | None = None

# Strong references to in-flight deliveries: a bare create_task() result can
# be garbage-collected mid-flight. drain() waits on these at shutdown.
_tasks: set[asyncio.Task] = set()


@dataclass(frozen=True)
class ClientContext:
    """Browser details captured from the request, for event matching."""

    ip: str | None
    user_agent: str | None
    fbp: str | None  # _fbp cookie set by the pixel (or our bootstrap)
    fbc: str | None  # _fbc cookie (click id) set by the pixel, or synthesised
    source_url: str | None


@dataclass(frozen=True)
class Delivery:
    """The outcome of trying to deliver one event."""

    ok: bool
    attempts: int
    last_error: str = ""


def enabled(meta: MetaConfig) -> bool:
    return meta.enabled


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalise_phone(raw: str) -> str:
    """Bangladeshi number -> digits with country code, as Meta expects."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("880"):
        return digits
    if digits.startswith("0"):
        return "880" + digits[1:]
    return "880" + digits if digits else ""


def fbclid_from(url: str | None) -> str | None:
    """The fbclid query parameter of a URL, if any."""
    if not url:
        return None
    try:
        values = parse_qs(urlparse(url).query).get("fbclid")
    except ValueError:
        return None
    return values[0] if values and values[0] else None


def synthesise_fbc(fbclid: str, now_ms: int | None = None) -> str:
    """The _fbc value the Pixel would have set for this click id."""
    return f"fb.1.{now_ms if now_ms is not None else int(time.time() * 1000)}.{fbclid}"


def client_context(
    request: Request,
    *,
    source_url: str | None = None,
    fbp_fallback: str | None = None,
    fbc_fallback: str | None = None,
) -> ClientContext:
    """
    Match keys from a storefront request: the real client address (via the
    configured proxy header), the user agent, and the Pixel cookies.

    The cookies come from the Cookie header first. The fallbacks are the same
    values as the page read them, sent in the body of POST /api/track, for a
    proxy that strips cookies. When the page was reached from an ad click but
    nothing has set _fbc yet, the fbclid in the page URL stands in for it.
    """
    url = source_url or request.headers.get("referer")
    fbc = request.cookies.get("_fbc") or fbc_fallback
    if not fbc:
        fbclid = fbclid_from(url)
        if fbclid:
            fbc = synthesise_fbc(fbclid)
    return ClientContext(
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
        fbp=request.cookies.get("_fbp") or fbp_fallback,
        fbc=fbc,
        source_url=url,
    )


def _match_keys(ctx: ClientContext) -> dict:
    user_data: dict = {}
    if ctx.ip:
        user_data["client_ip_address"] = ctx.ip
    if ctx.user_agent:
        user_data["client_user_agent"] = ctx.user_agent
    if ctx.fbp:
        user_data["fbp"] = ctx.fbp
    if ctx.fbc:
        user_data["fbc"] = ctx.fbc
    return user_data


def build_event(
    *,
    event_name: str,
    event_id: str,
    ctx: ClientContext,
    custom_data: dict | None = None,
    event_time: float | None = None,
) -> dict:
    """A non-purchase event: match keys from the request, no PII."""
    event: dict = {
        "event_name": event_name,
        "event_time": int(event_time or time.time()),
        "event_id": event_id,
        "action_source": "website",
        "user_data": _match_keys(ctx),
    }
    if custom_data:
        event["custom_data"] = custom_data
    if ctx.source_url:
        event["event_source_url"] = ctx.source_url
    return event


def build_purchase_event(
    *,
    order_no: str,
    customer_name: str,
    phone: str,
    quantity: int,
    unit_price: int,
    created_at: float | None,
    ctx: ClientContext,
    # The sold variant's catalogue id — the same one the browser's Pixel
    # event carried, so the two sides of the Purchase deduplicate.
    sku: str,
) -> dict:
    content_id = sku
    first_name = customer_name.strip().split()[0].lower() if customer_name.strip() else ""
    user_data: dict = {"country": [_sha256("bd")]}
    if first_name:
        user_data["fn"] = [_sha256(first_name)]
    phone_digits = normalise_phone(phone)
    if phone_digits:
        user_data["ph"] = [_sha256(phone_digits)]
    user_data.update(_match_keys(ctx))

    value = unit_price * quantity
    event: dict = {
        "event_name": "Purchase",
        "event_time": int(created_at or time.time()),
        "event_id": order_no,
        "action_source": "website",
        "user_data": user_data,
        "custom_data": {
            "currency": CURRENCY,
            "value": value,
            "content_type": "product",
            "content_ids": [content_id],
            "contents": [
                {
                    "id": content_id,
                    "quantity": quantity,
                    "item_price": unit_price,
                }
            ],
            "num_items": quantity,
            "order_id": order_no,
        },
    }
    if ctx.source_url:
        event["event_source_url"] = ctx.source_url
    return event


# --- delivery ----------------------------------------------------------------


def _events_url(meta: MetaConfig) -> str:
    return f"https://graph.facebook.com/{settings.meta_api_version}/{meta.pixel_id}/events"


def _payload(event: dict, meta: MetaConfig) -> dict:
    payload: dict = {"data": [event]}
    if meta.test_event_code:
        payload["test_event_code"] = meta.test_event_code
    return payload


def _label(event: dict) -> str:
    return f"{event.get('event_name')} {event.get('event_id')}"


async def deliver(event: dict, meta: MetaConfig, *, retry: bool = True) -> Delivery:
    """
    Post one event, retrying on timeouts, connection errors, 5xx and 429 with
    the RETRY_DELAYS backoff. Other 4xx are final: the payload or the token
    is wrong and sending it again would not change that.
    """
    label = _label(event)
    delays = (0.0, *RETRY_DELAYS) if retry else (0.0,)
    attempts = 0
    last_error = ""
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=transport) as client:
        for delay in delays:
            if delay:
                await asyncio.sleep(delay)
            attempts += 1
            try:
                res = await client.post(
                    _events_url(meta),
                    json=_payload(event, meta),
                    params={"access_token": meta.access_token},
                )
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                log.warning("CAPI %s attempt %d failed: %s", label, attempts, last_error)
                continue
            if res.is_success:
                log.info("CAPI %s sent (attempt %d): %s", label, attempts, res.text[:300])
                return Delivery(ok=True, attempts=attempts)
            last_error = f"HTTP {res.status_code}: {res.text[:500]}"
            if res.status_code in RETRYABLE_STATUS:
                log.warning("CAPI %s attempt %d: %s", label, attempts, last_error)
                continue
            log.warning("CAPI %s rejected, not retrying: %s", label, last_error)
            break
    return Delivery(ok=False, attempts=attempts, last_error=last_error)


async def persist_failed(event: dict, store_id: int, attempts: int, last_error: str) -> None:
    """Park an undeliverable event for a later resend. Never raises."""
    # Imported here so the sender can be tested without a database engine.
    from api.db import async_session

    try:
        async with async_session() as session:
            session.add(
                MetaCapiFailedEvent(
                    store_id=store_id,
                    payload=event,
                    attempts=attempts,
                    last_error=last_error[:2000],
                )
            )
            await session.commit()
        log.error(
            "CAPI %s gave up after %d attempt(s), parked for resend: %s",
            _label(event),
            attempts,
            last_error,
        )
    except Exception:  # noqa: BLE001 — logging is all that is left to do
        log.exception("CAPI %s could not be parked after failing: %s", _label(event), last_error)


async def deliver_or_park(event: dict, meta: MetaConfig, store_id: int) -> Delivery:
    """The full path for a new event: deliver with retries, park on failure."""
    result = await deliver(event, meta)
    if not result.ok:
        await persist_failed(event, store_id, result.attempts, result.last_error)
    return result


def dispatch(event: dict, meta: MetaConfig, store_id: int) -> None:
    """
    Schedule delivery as a task of its own, with the store's pixel and token.
    Returns at once; the request that produced the event never waits on Meta,
    and the task outlives it. A store without CAPI configured sends nothing.
    """
    if not meta.enabled:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        log.warning("CAPI %s dropped: no running event loop", _label(event))
        return
    task = loop.create_task(deliver_or_park(event, meta, store_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def pending() -> int:
    """Deliveries still in flight in this worker."""
    return sum(1 for task in _tasks if not task.done())


async def drain(timeout: float = 20.0) -> None:
    """Wait for in-flight deliveries; called from the app's shutdown."""
    live = [task for task in _tasks if not task.done()]
    if not live:
        return
    log.info("waiting up to %.0fs for %d CAPI delivery(ies)", timeout, len(live))
    await asyncio.wait(live, timeout=timeout)


def send_purchase(meta: MetaConfig, store_id: int, **kwargs) -> None:
    """Send a Purchase event for a web order (see build_purchase_event)."""
    if not meta.enabled:
        return
    dispatch(build_purchase_event(**kwargs), meta, store_id)


# --- parked events -----------------------------------------------------------


async def failed_count(session: AsyncSession, store_id: int | None = None) -> int:
    query = select(func.count()).select_from(MetaCapiFailedEvent)
    if store_id is not None:
        query = query.where(MetaCapiFailedEvent.store_id == store_id)
    return int(await session.scalar(query) or 0)


async def resend_failed(
    session: AsyncSession,
    meta_for: "Callable[[int], Awaitable[MetaConfig | None]]",
    ids: list[int] | None = None,
    limit: int = 100,
    store_id: int | None = None,
) -> dict:
    """
    Try each parked event once more (one attempt, no backoff: the operator is
    waiting), each with its own store's pixel and token via `meta_for`.
    Delivered rows are deleted; the rest keep the new error.
    """
    query = select(MetaCapiFailedEvent).order_by(MetaCapiFailedEvent.id).limit(limit)
    if ids:
        query = query.where(MetaCapiFailedEvent.id.in_(ids))
    if store_id is not None:
        query = query.where(MetaCapiFailedEvent.store_id == store_id)
    rows = (await session.scalars(query)).all()
    sent = 0
    still_failing = 0
    for row in rows:
        meta = await meta_for(row.store_id)
        if meta is None or not meta.enabled:
            row.last_error = "Conversions API is not configured for this store"
            still_failing += 1
            continue
        result = await deliver(row.payload, meta, retry=False)
        if result.ok:
            await session.delete(row)
            sent += 1
        else:
            row.attempts += result.attempts
            row.last_error = result.last_error[:2000]
            still_failing += 1
    await session.commit()
    return {
        "sent": sent,
        "failed": still_failing,
        "remaining": await failed_count(session, store_id),
    }
