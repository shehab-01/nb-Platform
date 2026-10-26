"""Couriers calling us: Carrybee's and Pathao's status webhooks.

Each store gets its own URL, /api/webhooks/carrybee/<token>, shown on its
Settings page and pasted into Carrybee's Webhook Integration page. The token
is random and names the store — Carrybee's payload only carries Carrybee's
own pickup-store id, which is not ours to resolve by. It reaches the API
through the web app's /api rewrite like every other call, on whichever of
our hostnames the URL was copied from.

Two kinds of request arrive:

- The integration check ({"event": "webhook.integration"}), sent when the URL
  is saved in Carrybee's panel. It carries the webhook secret in
  X-CB-Webhook-Integration-Header, and Carrybee wants 202 with that header
  set to the fixed value its Webhook Integration page shows (saved in the
  store's settings). It changes nothing here.
- Order events. Each carries X-Carrybee-Webhook-Signature, which must equal
  the webhook secret saved for the store (the one typed into Carrybee's
  panel); anything else is refused before the body is read as an event.

Every accepted event is answered 202 whether or not it matched a parcel:
Carrybee only needs to know we took it.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.db import get_session
from api.models import StoreSettings
from api.services import carrybee_sync, pathao_sync

log = logging.getLogger("webhooks")

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

INTEGRATION_HEADER = "X-CB-Webhook-Integration-Header"
SIGNATURE_HEADER = "X-Carrybee-Webhook-Signature"
MAX_BODY_BYTES = 64 * 1024


def signature_ok(received: str | None, secret: str) -> bool:
    """Carrybee's signature header against the saved secret, in constant
    time. Its own example wraps the value in quotes, so quotes and spaces
    around it are not part of it."""
    if not received or not secret:
        return False
    value = received.strip().strip('"').strip()
    return hmac.compare_digest(value.encode(), secret.encode())


def _body_hmacs(secret: str, raw: bytes) -> tuple[str, str]:
    digest = hmac.new(secret.encode(), raw, hashlib.sha256).digest()
    return digest.hex(), base64.b64encode(digest).decode()


def hmac_ok(received: str | None, secret: str, raw: bytes) -> bool:
    """The header as an HMAC-SHA256 of the body under the secret, hex or
    base64, optionally "sha256="-prefixed. The couriers' docs say the header
    carries the secret itself; this accepts the stronger form too, in case a
    courier signs that way."""
    if not received or not secret:
        return False
    value = received.strip().strip('"').strip().removeprefix("sha256=")
    hex_mac, b64_mac = _body_hmacs(secret, raw)
    return hmac.compare_digest(value.lower().encode(), hex_mac.encode()) or hmac.compare_digest(
        value.encode(), b64_mac.encode()
    )


def describe_signature(headers, received: str | None, secret: str) -> str:
    """What a refused call carried, safe to log: header names that look like a
    signature (never values) and how the received value compares in length.
    Enough to tell a wrong secret from a different signing scheme."""
    names = sorted(
        name for name in headers.keys()
        if any(word in name.lower() for word in ("signature", "secret", "carrybee", "cb-", "pathao", "auth"))
    )
    if not received:
        got = "no signature header"
    else:
        value = received.strip().strip('"').strip()
        got = f"signature length {len(value)}, saved secret length {len(secret)}"
    return f"{got}; headers: {', '.join(names) or 'none'}"


@router.post("/carrybee/{token}", status_code=202)
async def carrybee_webhook(
    token: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> Response:
    store_id = await session.scalar(
        select(StoreSettings.store_id).where(StoreSettings.carrybee_webhook_token == token)
    )
    if store_id is None:
        # Logged without the token: a stale URL in the courier's panel shows
        # up here, and nowhere else.
        log.warning("Carrybee webhook refused: unknown URL token")
        raise HTTPException(status_code=404, detail="Unknown webhook")

    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Too large")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Body is not JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body is not a JSON object")

    integrations = await stores.load_integrations(session, store_id)
    cfg = integrations.carrybee if integrations else stores.CarrybeeConfig()
    secret = cfg.webhook_secret

    if payload.get("event") == "webhook.integration":
        # Carrybee sends the webhook secret in this header and wants back the
        # fixed value its panel shows — a different one. Echoing is only a
        # fallback for a store that has not saved that value yet.
        received = request.headers.get(INTEGRATION_HEADER, "")
        if secret and received and not signature_ok(received, secret):
            log.warning("Carrybee integration check for store %s: secret does not match", store_id)
            raise HTTPException(status_code=401, detail="Bad secret")
        log.info("Carrybee webhook integration check for store %s", store_id)
        answer = cfg.integration_header or received
        return Response(status_code=202, headers={INTEGRATION_HEADER: answer})

    received = request.headers.get(SIGNATURE_HEADER)
    if not (signature_ok(received, secret) or hmac_ok(received, secret, raw)):
        # Never log the header or the secret: either could be the real one.
        log.warning(
            "Carrybee webhook for store %s refused: bad or missing signature (%s)",
            store_id,
            describe_signature(request.headers, received, secret),
        )
        raise HTTPException(status_code=401, detail="Bad signature")

    # Parcels already booked keep updating even if Carrybee has since been
    # switched off for new bookings: their story is still ours to record.
    outcome = await carrybee_sync.handle_event(session, store_id, payload)
    await session.commit()
    log.info(
        "Carrybee webhook store %s %s: %s",
        store_id,
        payload.get("consignment_id"),
        outcome,
    )
    return Response(status_code=202)


# --- Pathao -------------------------------------------------------------------

PATHAO_INTEGRATION_HEADER = "X-Pathao-Merchant-Webhook-Integration-Secret"
PATHAO_SIGNATURE_HEADER = "X-PATHAO-Signature"


@router.post("/pathao/{token}", status_code=202)
async def pathao_webhook(
    token: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Pathao's status webhook, the same shape as Carrybee's: the token in
    the URL names the store, X-PATHAO-Signature must equal the secret saved
    for it, and every answer carries the integration header Pathao's panel
    asks for. That value is shown in their panel, not a secret.

    Pathao's integration check is not documented beyond "the response must
    carry the header", so any request that is not an order event (no
    consignment id) is treated as one: answered 202 with the header, and
    nothing changes."""
    store_id = await session.scalar(
        select(StoreSettings.store_id).where(StoreSettings.pathao_webhook_token == token)
    )
    if store_id is None:
        log.warning("Pathao webhook refused: unknown URL token")
        raise HTTPException(status_code=404, detail="Unknown webhook")

    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Too large")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Body is not JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body is not a JSON object")

    integrations = await stores.load_integrations(session, store_id)
    cfg = integrations.pathao if integrations else stores.PathaoConfig()
    headers = {PATHAO_INTEGRATION_HEADER: cfg.integration_header} if cfg.integration_header else {}

    if not payload.get("consignment_id"):
        log.info(
            "Pathao webhook check for store %s (event %r)", store_id, payload.get("event")
        )
        return Response(status_code=202, headers=headers)

    received = request.headers.get(PATHAO_SIGNATURE_HEADER)
    if not (
        signature_ok(received, cfg.webhook_secret) or hmac_ok(received, cfg.webhook_secret, raw)
    ):
        # Never log the header or the secret: either could be the real one.
        log.warning(
            "Pathao webhook for store %s refused: bad or missing signature (%s)",
            store_id,
            describe_signature(request.headers, received, cfg.webhook_secret),
        )
        raise HTTPException(status_code=401, detail="Bad signature", headers=headers)

    # Parcels already booked keep updating even if Pathao has since been
    # switched off for new bookings: their story is still ours to record.
    outcome = await pathao_sync.handle_event(session, store_id, payload)
    await session.commit()
    log.info(
        "Pathao webhook store %s %s: %s",
        store_id,
        payload.get("consignment_id"),
        outcome,
    )
    return Response(status_code=202, headers=headers)
