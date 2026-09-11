"""Pathao Courier merchant API: book parcels and read their delivery status.

Two calls matter. Issue-token gives a bearer token that lives for days; it is
kept in the integration_tokens table so every worker process shares one and a
restart never re-issues. Create-order books one consignment and returns the
tracking number, which is stored on the order.

Docs: https://merchant.pathao.com/courier/developer-api
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from api.config import settings
from api.db import async_session
from api.models import IntegrationToken, Order
from api.phone import bd_mobile
from api.stores import PathaoConfig

log = logging.getLogger("pathao")

PROVIDER = "pathao"
TIMEOUT_SECONDS = 20
# Re-issue this long before the token actually dies, so a request never
# starts with a token that expires mid-flight.
EXPIRY_MARGIN = timedelta(hours=1)

DELIVERY_NORMAL = 48
ITEM_PARCEL = 2
# Pathao's item_type codes, by the name the store settings use.
ITEM_TYPES = {"document": 1, "parcel": 2, "fragile": 3}
MIN_WEIGHT_KG = 0.5
MAX_WEIGHT_KG = 10.0
# Pathao's limits (the sandbox enforces a 64-character name despite the docs).
NAME_MIN, NAME_MAX = 3, 64
ADDRESS_MIN, ADDRESS_MAX = 10, 220


class PathaoError(Exception):
    """A Pathao call failed; `message` is safe to show to staff."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        field_errors: dict[str, list[str]] | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.status = status
        self.field_errors = field_errors or {}


class PathaoAuthError(PathaoError):
    """The bearer token was refused."""


@dataclass
class Consignment:
    consignment_id: str
    order_status: str
    delivery_fee: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def enabled(cfg: PathaoConfig) -> bool:
    return cfg.enabled


def is_sandbox() -> bool:
    # The base URL (sandbox vs live) is still a deployment-wide setting.
    return "sandbox" in settings.pathao_base_url


def tracking_url(consignment_id: str, phone: str) -> str:
    return (
        f"{settings.pathao_tracking_url}?consignment_id={consignment_id}"
        f"&phone={recipient_phone(phone) or ''}"
    )


def recipient_phone(raw: str) -> str | None:
    """Bangladeshi mobile as Pathao wants it: exactly 11 digits, 01XXXXXXXXX."""
    return bd_mobile(raw)


def item_weight_kg(cfg: PathaoConfig, quantity: int) -> float:
    """The store's per-unit weight times the quantity, inside Pathao's range."""
    weight = cfg.unit_weight_kg * max(quantity, 1)
    return round(min(max(weight, MIN_WEIGHT_KG), MAX_WEIGHT_KG), 2)


def item_type_code(cfg: PathaoConfig) -> int:
    return ITEM_TYPES.get(cfg.item_type, ITEM_PARCEL)


def build_order_payload(order: Order, cfg: PathaoConfig, order_no: str) -> dict[str, Any]:
    """The create-order body for one of our orders, or PathaoError if the
    customer details can't satisfy Pathao's validation."""
    problems: dict[str, list[str]] = {}

    name = " ".join((order.customer_name or "").split())
    if len(name) < NAME_MIN:
        problems["recipient_name"] = [
            f"Customer name must be at least {NAME_MIN} characters"
        ]
    name = name[:NAME_MAX]

    phone = recipient_phone(order.phone)
    if phone is None:
        problems["recipient_phone"] = [
            "Phone must be an 11-digit Bangladeshi mobile number (01XXXXXXXXX)"
        ]

    address = " ".join((order.address or "").split())
    if len(address) < ADDRESS_MIN:
        problems["recipient_address"] = [
            f"Address must be at least {ADDRESS_MIN} characters"
        ]
    address = address[:ADDRESS_MAX]

    if problems:
        raise PathaoError("Order details need fixing", field_errors=problems)

    # Every line, so the rider's manifest matches what is in the parcel. Falls
    # back to the order's summary columns for a row written before line items
    # existed.
    if order.items:
        description = ", ".join(
            f"{item.product_name} x{item.quantity}" for item in order.items
        )[:200]
    else:
        description = f"{order.product_name} x{order.quantity}"[:200]
    payload: dict[str, Any] = {
        "store_id": cfg.store_id,
        "merchant_order_id": order_no,
        "recipient_name": name,
        "recipient_phone": phone,
        "recipient_address": address,
        "delivery_type": DELIVERY_NORMAL,
        "item_type": item_type_code(cfg),
        "item_quantity": max(order.quantity, 1),
        "item_weight": item_weight_kg(cfg, order.quantity),
        "item_description": description,
        # Cash on delivery for the full order value.
        "amount_to_collect": int(order.total_amount),
    }
    if order.comment:
        payload["special_instruction"] = " ".join(order.comment.split())[:200]
    return payload


# --- HTTP -------------------------------------------------------------------


def _url(path: str) -> str:
    return f"{settings.pathao_base_url}/aladdin/api/v1/{path.lstrip('/')}"


def _post_sync(path: str, body: dict, token: str | None) -> tuple[int, Any]:
    headers = {"Content-Type": "application/json; charset=UTF-8"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    res = requests.post(_url(path), json=body, headers=headers, timeout=TIMEOUT_SECONDS)
    return res.status_code, _json_or_text(res)


def _get_sync(path: str, token: str) -> tuple[int, Any]:
    res = requests.get(
        _url(path),
        headers={"Authorization": f"Bearer {token}"},
        timeout=TIMEOUT_SECONDS,
    )
    return res.status_code, _json_or_text(res)


def _json_or_text(res: requests.Response) -> Any:
    try:
        return res.json()
    except ValueError:
        return res.text[:500]


def _raise_for(status: int, body: Any) -> None:
    """Turn a non-2xx Pathao reply into a PathaoError with a readable message."""
    if status == 401:
        raise PathaoAuthError("Pathao rejected our access token", status=status)
    message = "Pathao request failed"
    errors: dict[str, list[str]] = {}
    if isinstance(body, dict):
        message = str(body.get("message") or message)
        raw_errors = body.get("errors")
        if isinstance(raw_errors, dict):
            errors = {
                str(k): [str(m) for m in (v if isinstance(v, list) else [v])]
                for k, v in raw_errors.items()
            }
        elif isinstance(body.get("error"), dict):
            desc = body["error"].get("description")
            if desc:
                message = f"{message}: {desc}"
    elif isinstance(body, str) and body:
        message = f"{message} ({status}): {body[:200]}"
    raise PathaoError(message, status=status, field_errors=errors)


# --- Tokens -----------------------------------------------------------------


def _token_row_from(body: dict, store_id: int) -> IntegrationToken:
    expires_in = int(body.get("expires_in") or 0)
    return IntegrationToken(
        store_id=store_id,
        provider=PROVIDER,
        access_token=str(body["access_token"]),
        refresh_token=body.get("refresh_token"),
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=expires_in),
    )


async def _issue_token(
    cfg: PathaoConfig, store_id: int, refresh_token: str | None
) -> IntegrationToken:
    """Ask Pathao for a token: by refresh token when we have one, else by
    password. A dead refresh token silently falls back to the password."""
    base = {"client_id": cfg.client_id, "client_secret": cfg.client_secret}
    if refresh_token:
        status, body = await asyncio.to_thread(
            _post_sync,
            "issue-token",
            {**base, "grant_type": "refresh_token", "refresh_token": refresh_token},
            None,
        )
        if status == 200 and isinstance(body, dict) and body.get("access_token"):
            return _token_row_from(body, store_id)
        log.warning("Pathao refresh token rejected (%s); using password grant", status)

    status, body = await asyncio.to_thread(
        _post_sync,
        "issue-token",
        {
            **base,
            "grant_type": "password",
            "username": cfg.username,
            "password": cfg.password,
        },
        None,
    )
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        detail = body.get("message") if isinstance(body, dict) else str(body)[:200]
        raise PathaoError(
            f"Pathao login failed ({status}): {detail or 'no access token returned'}",
            status=status,
        )
    return _token_row_from(body, store_id)


async def get_access_token(cfg: PathaoConfig, store_id: int, *, force: bool = False) -> str:
    """A usable bearer token for this store, issued or refreshed as needed.

    Uses its own DB session so the caller's transaction (which may hold row
    locks on orders) is never committed from here.
    """
    if not cfg.enabled:
        raise PathaoError("Pathao is not configured for this store")
    async with async_session() as session:
        row = await session.get(IntegrationToken, (store_id, PROVIDER))
        now = datetime.now(timezone.utc)
        if row and not force and row.expires_at - EXPIRY_MARGIN > now:
            return row.access_token
        fresh = await _issue_token(cfg, store_id, row.refresh_token if row else None)
        if row is None:
            session.add(fresh)
        else:
            row.access_token = fresh.access_token
            row.refresh_token = fresh.refresh_token
            row.expires_at = fresh.expires_at
        await session.commit()
        log.info("Pathao token issued for store %s; expires %s", store_id, fresh.expires_at.isoformat())
        return fresh.access_token


async def _call(
    cfg: PathaoConfig, store_id: int, method: str, path: str, body: dict | None = None
) -> Any:
    """One authenticated call. A 401 re-issues the token and retries once."""
    token = await get_access_token(cfg, store_id)
    for attempt in (1, 2):
        if method == "GET":
            status, data = await asyncio.to_thread(_get_sync, path, token)
        else:
            status, data = await asyncio.to_thread(_post_sync, path, body or {}, token)
        if 200 <= status < 300:
            return data
        if status == 401 and attempt == 1:
            token = await get_access_token(cfg, store_id, force=True)
            continue
        _raise_for(status, data)
    raise PathaoError("Pathao request failed")  # unreachable


# --- Public operations ------------------------------------------------------


def _consignment_from(data: Any) -> Consignment:
    if not isinstance(data, dict) or not data.get("consignment_id"):
        raise PathaoError("Pathao replied without a consignment id")
    fee = data.get("delivery_fee")
    return Consignment(
        consignment_id=str(data["consignment_id"]),
        order_status=str(data.get("order_status") or data.get("order_status_slug") or ""),
        delivery_fee=int(round(float(fee))) if fee not in (None, "") else None,
        raw=data,
    )


async def create_order(order: Order, cfg: PathaoConfig, order_no: str) -> Consignment:
    """Book one parcel with the order's store's credentials. Raises PathaoError
    with field errors when our data doesn't pass Pathao's checks, and on any
    transport or auth failure."""
    payload = build_order_payload(order, cfg, order_no)
    try:
        body = await _call(cfg, order.store_id, "POST", "orders", payload)
    except requests.RequestException as exc:
        raise PathaoError(f"Could not reach Pathao: {exc}") from exc
    return _consignment_from(body.get("data") if isinstance(body, dict) else None)


async def order_info(cfg: PathaoConfig, store_id: int, consignment_id: str) -> Consignment:
    try:
        body = await _call(cfg, store_id, "GET", f"orders/{consignment_id}/info")
    except requests.RequestException as exc:
        raise PathaoError(f"Could not reach Pathao: {exc}") from exc
    return _consignment_from(body.get("data") if isinstance(body, dict) else None)


async def list_stores(cfg: PathaoConfig, store_id: int) -> list[dict[str, Any]]:
    try:
        body = await _call(cfg, store_id, "GET", "stores")
    except requests.RequestException as exc:
        raise PathaoError(f"Could not reach Pathao: {exc}") from exc
    data = body.get("data") if isinstance(body, dict) else None
    stores = data.get("data") if isinstance(data, dict) else None
    return stores if isinstance(stores, list) else []


async def price_plan(
    cfg: PathaoConfig, store_id: int, city_id: int, zone_id: int, quantity: int = 1
) -> dict[str, Any]:
    body = await _call(
        cfg,
        store_id,
        "POST",
        "merchant/price-plan",
        {
            "store_id": cfg.store_id,
            "item_type": item_type_code(cfg),
            "delivery_type": DELIVERY_NORMAL,
            "item_weight": item_weight_kg(cfg, quantity),
            "recipient_city": city_id,
            "recipient_zone": zone_id,
        },
    )
    data = body.get("data") if isinstance(body, dict) else None
    return data if isinstance(data, dict) else {}


def is_rate_limited(exc: PathaoError) -> bool:
    return exc.status == 429


def error_text(exc: PathaoError) -> str:
    """One line for staff: the message plus any per-field complaints."""
    if not exc.field_errors:
        return exc.message
    details = "; ".join(
        f"{field}: {' '.join(msgs)}" for field, msgs in exc.field_errors.items()
    )
    return f"{exc.message} — {details}"


__all__ = [
    "Consignment",
    "PathaoError",
    "build_order_payload",
    "create_order",
    "enabled",
    "error_text",
    "is_sandbox",
    "list_stores",
    "order_info",
    "price_plan",
    "recipient_phone",
    "tracking_url",
]
