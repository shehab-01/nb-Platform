"""Couriers calling us: Carrybee's and Pathao's status webhooks.

Each courier account (Settings → Courier) has its own URL,
/api/webhooks/<courier>/<token>, pasted once into that merchant account's
Webhook Integration page — a courier calls one URL per account. The token is
random and names the account; every store using the account (its
store_settings.*_courier_account_id) gets the events, each matched only
among those stores' parcels. URLs from before accounts existed named a store
and are still accepted, as that store's account. The call reaches the API
through the web app's /api rewrite like every other, on whichever of our
hostnames the URL was copied from.

Two kinds of request arrive:

- The integration check, sent when the URL is saved in the courier's panel.
  It wants 202 with a header set to the fixed value that panel shows (saved
  on the account). It changes nothing here.
- Order events, each carrying a signature header that must equal the
  account's webhook secret; anything else is refused before the body is
  read as an event.

Every accepted event is answered 202 whether or not it matched a parcel:
the courier only needs to know we took it.
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
from api.models import CourierAccount, StoreSettings
from api.services import carrybee_sync, pathao_sync
from api.services.courier import CARRYBEE, LABELS, PATHAO

log = logging.getLogger("webhooks")

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

INTEGRATION_HEADER = "X-CB-Webhook-Integration-Header"
SIGNATURE_HEADER = "X-Carrybee-Webhook-Signature"
MAX_BODY_BYTES = 64 * 1024


async def resolve_account(
    session: AsyncSession, courier: str, token: str
) -> CourierAccount | None:
    """The courier account a webhook URL names: by its own token, or — for
    a URL pasted before accounts existed — by the old per-store token, as
    that store's account."""
    account = await session.scalar(
        select(CourierAccount).where(
            CourierAccount.courier == courier, CourierAccount.webhook_token == token
        )
    )
    if account is not None:
        return account
    old_token = getattr(StoreSettings, f"{courier}_webhook_token")
    account_id = await session.scalar(
        select(getattr(StoreSettings, f"{courier}_courier_account_id")).where(old_token == token)
    )
    return await session.get(CourierAccount, account_id) if account_id is not None else None


async def account_store_ids(session: AsyncSession, courier: str, account_id: int) -> list[int]:
    """Every store booking through the account: its events may be for any of
    them, and for no one else."""
    column = getattr(StoreSettings, f"{courier}_courier_account_id")
    return list(
        (await session.scalars(select(StoreSettings.store_id).where(column == account_id))).all()
    )


async def _account_or_404(session: AsyncSession, courier: str, token: str) -> CourierAccount:
    account = await resolve_account(session, courier, token)
    if account is None:
        # Logged without the token: a stale URL in the courier's panel shows
        # up here, and nowhere else.
        log.warning("%s webhook refused: unknown URL token", LABELS[courier])
        raise HTTPException(status_code=404, detail="Unknown webhook")
    return account


async def _read_json(request: Request) -> tuple[bytes, dict]:
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Too large")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Body is not JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body is not a JSON object")
    return raw, payload


def signature_ok(received: str | None, secret: str) -> bool:
    """The signature header against the saved secret, in constant time.
    Carrybee's own example wraps the value in quotes, so quotes and spaces
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
    account = await _account_or_404(session, CARRYBEE, token)
    raw, payload = await _read_json(request)
    cfg = stores.carrybee_config(account, None)
    secret = cfg.webhook_secret

    if payload.get("event") == "webhook.integration":
        # Carrybee sends the webhook secret in this header and wants back the
        # fixed value its panel shows — a different one. Echoing is only a
        # fallback for an account that has not saved that value yet.
        received = request.headers.get(INTEGRATION_HEADER, "")
        if secret and received and not signature_ok(received, secret):
            log.warning(
                "Carrybee integration check for account %s: secret does not match", account.id
            )
            raise HTTPException(status_code=401, detail="Bad secret")
        log.info("Carrybee webhook integration check for account %s", account.id)
        answer = cfg.integration_header or received
        return Response(status_code=202, headers={INTEGRATION_HEADER: answer})

    received = request.headers.get(SIGNATURE_HEADER)
    if not (signature_ok(received, secret) or hmac_ok(received, secret, raw)):
        # Never log the header or the secret: either could be the real one.
        log.warning(
            "Carrybee webhook for account %s refused: bad or missing signature (%s)",
            account.id,
            describe_signature(request.headers, received, secret),
        )
        raise HTTPException(status_code=401, detail="Bad signature")

    # Parcels already booked keep updating even if Carrybee has since been
    # switched off for new bookings: their story is still ours to record.
    store_ids = await account_store_ids(session, CARRYBEE, account.id)
    outcome = await carrybee_sync.handle_event(session, store_ids, payload)
    await session.commit()
    log.info(
        "Carrybee webhook account %s %s: %s",
        account.id,
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
    the URL names the account, X-PATHAO-Signature must equal its secret, and
    every answer carries the integration header Pathao's panel asks for.
    That value is shown in their panel, not a secret.

    Pathao's integration check is not documented beyond "the response must
    carry the header", so any request that is not an order event (no
    consignment id) is treated as one: answered 202 with the header, and
    nothing changes."""
    account = await _account_or_404(session, PATHAO, token)
    raw, payload = await _read_json(request)
    cfg = stores.pathao_config(account, None)
    headers = {PATHAO_INTEGRATION_HEADER: cfg.integration_header} if cfg.integration_header else {}

    if not payload.get("consignment_id"):
        log.info(
            "Pathao webhook check for account %s (event %r)", account.id, payload.get("event")
        )
        return Response(status_code=202, headers=headers)

    received = request.headers.get(PATHAO_SIGNATURE_HEADER)
    if not (
        signature_ok(received, cfg.webhook_secret) or hmac_ok(received, cfg.webhook_secret, raw)
    ):
        # Never log the header or the secret: either could be the real one.
        log.warning(
            "Pathao webhook for account %s refused: bad or missing signature (%s)",
            account.id,
            describe_signature(request.headers, received, cfg.webhook_secret),
        )
        raise HTTPException(status_code=401, detail="Bad signature", headers=headers)

    # Parcels already booked keep updating even if Pathao has since been
    # switched off for new bookings: their story is still ours to record.
    store_ids = await account_store_ids(session, PATHAO, account.id)
    outcome = await pathao_sync.handle_event(session, store_ids, payload)
    await session.commit()
    log.info(
        "Pathao webhook account %s %s: %s",
        account.id,
        payload.get("consignment_id"),
        outcome,
    )
    return Response(status_code=202, headers=headers)
