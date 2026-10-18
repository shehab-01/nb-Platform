"""Couriers calling us: Carrybee's status webhook.

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

import hmac
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores
from api.db import get_session
from api.models import StoreSettings
from api.services import carrybee_sync

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

    if not signature_ok(request.headers.get(SIGNATURE_HEADER), secret):
        # Never log the header or the secret: either could be the real one.
        log.warning("Carrybee webhook for store %s refused: bad or missing signature", store_id)
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
