"""Carrybee courier merchant API: book parcels and read their delivery status.

Every call carries three static headers (Client-ID, Client-Secret,
Client-Context); there is no token to issue or refresh. Create-order books
one consignment and returns its id, which goes on the order. Status changes
arrive by webhook (api.routers.webhooks); order_details is the fallback the
slow poll in api.services.carrybee_sync uses for anything a webhook missed.

City, zone and area ids are optional on an order: without them Carrybee
places the parcel from the address text itself (tried in the sandbox), so
nothing here asks staff to pick a location.

Docs: https://developers.carrybee.com (API v2).
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import requests

from api.config import settings
from api.models import Order
from api.phone import bd_mobile
from api.stores import CarrybeeConfig

log = logging.getLogger("carrybee")

TIMEOUT_SECONDS = 20
DELIVERY_NORMAL = 1
PRODUCT_TYPES = (1, 2, 3)  # parcel, book, document
MIN_WEIGHT_G, MAX_WEIGHT_G = 1, 25_000
MAX_QUANTITY = 200
MAX_COLLECT = 100_000
# Carrybee's limits.
NAME_MIN, NAME_MAX = 2, 99
ADDRESS_MIN, ADDRESS_MAX = 10, 200
TEXT_MAX = 254
MERCHANT_ORDER_ID_MAX = 49


class CarrybeeError(Exception):
    """A Carrybee call failed; `message` is safe to show to staff."""

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


@dataclass
class Consignment:
    consignment_id: str
    status: str | None
    delivery_fee: int | None = None
    status_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def is_sandbox() -> bool:
    return "sandbox" in settings.carrybee_base_url


def normalise_status(raw: str | None) -> str | None:
    """Carrybee's status as its event slug, whichever way it was written.

    Webhooks name the status by event ("order.pickup-requested"); the details
    call by label ("Pickup requested"). Both become "pickup-requested", so one
    order never carries two spellings of the same state.
    """
    text = (raw or "").strip().lower()
    if text.startswith("order."):
        text = text[len("order."):]
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^a-z0-9-]", "", text).strip("-")
    return text or None


def parse_time(raw: Any) -> datetime | None:
    """An ISO 8601 timestamp with its zone, or None if it is not one."""
    if not isinstance(raw, str) or not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo is not None else None


def money(raw: Any) -> int | None:
    if raw in (None, ""):
        return None
    try:
        return int(round(float(raw)))
    except (TypeError, ValueError):
        return None


def item_weight_g(cfg: CarrybeeConfig, quantity: int) -> int:
    """The store's per-unit weight times the quantity, inside Carrybee's range."""
    weight = cfg.unit_weight_g * max(quantity, 1)
    return min(max(weight, MIN_WEIGHT_G), MAX_WEIGHT_G)


def build_order_payload(order: Order, cfg: CarrybeeConfig, order_no: str) -> dict[str, Any]:
    """The create-order body for one of our orders, or CarrybeeError if the
    customer details can't satisfy Carrybee's validation."""
    problems: dict[str, list[str]] = {}

    name = " ".join((order.customer_name or "").split())
    if len(name) < NAME_MIN:
        problems["recipient_name"] = [f"Customer name must be at least {NAME_MIN} characters"]
    name = name[:NAME_MAX]

    phone = bd_mobile(order.phone)
    if phone is None:
        problems["recipient_phone"] = [
            "Phone must be an 11-digit Bangladeshi mobile number (01XXXXXXXXX)"
        ]

    address = " ".join((order.address or "").split())
    if len(address) < ADDRESS_MIN:
        problems["recipient_address"] = [f"Address must be at least {ADDRESS_MIN} characters"]
    address = address[:ADDRESS_MAX]

    collect = int(order.total_amount)
    if collect > MAX_COLLECT:
        problems["collectable_amount"] = [f"Carrybee collects at most ৳{MAX_COLLECT:,}"]

    if problems:
        raise CarrybeeError("Order details need fixing", field_errors=problems)

    # Every line, so the rider's manifest matches what is in the parcel.
    if order.items:
        description = ", ".join(f"{item.product_name} x{item.quantity}" for item in order.items)
    else:
        description = f"{order.product_name} x{order.quantity}"
    quantity = min(max(order.quantity, 1), MAX_QUANTITY)
    payload: dict[str, Any] = {
        "store_id": cfg.store_id,
        "merchant_order_id": order_no[:MERCHANT_ORDER_ID_MAX],
        "delivery_type": DELIVERY_NORMAL,
        "product_type": cfg.product_type if cfg.product_type in PRODUCT_TYPES else 1,
        "recipient_phone": phone,
        "recipient_name": name,
        "recipient_address": address,
        "item_weight": item_weight_g(cfg, order.quantity),
        "item_quantity": quantity,
        # Cash on delivery for the full order value.
        "collectable_amount": max(collect, 0),
        "product_description": description[:TEXT_MAX],
    }
    if order.comment:
        payload["special_instruction"] = " ".join(order.comment.split())[:TEXT_MAX]
    return payload


# --- HTTP -------------------------------------------------------------------


def _headers(cfg: CarrybeeConfig) -> dict[str, str]:
    return {
        "Client-ID": cfg.client_id,
        "Client-Secret": cfg.client_secret,
        "Client-Context": cfg.client_context,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _url(path: str) -> str:
    return f"{settings.carrybee_base_url}/api/v2/{path.lstrip('/')}"


def _request_sync(
    cfg: CarrybeeConfig, method: str, path: str, body: Any | None
) -> tuple[int, Any]:
    res = requests.request(
        method, _url(path), json=body, headers=_headers(cfg), timeout=TIMEOUT_SECONDS
    )
    try:
        data = res.json()
    except ValueError:
        data = res.text[:500]
    return res.status_code, data


def _raise_for(status: int, body: Any) -> None:
    """Turn a failed Carrybee reply into a CarrybeeError with a readable message.

    Carrybee answers {"error": true, "message": ...}, plus "causes" on a
    validation error: {"field": [{"type": "min", "attribute": {"value": 10}}]}.
    Wrong credentials come back as a bare "An unexpected error occurred".
    """
    message = "Carrybee request failed"
    errors: dict[str, list[str]] = {}
    if isinstance(body, dict):
        message = str(body.get("message") or message)
        causes = body.get("causes")
        if isinstance(causes, dict):
            for name, items in causes.items():
                texts = []
                for item in items if isinstance(items, list) else [items]:
                    if isinstance(item, dict):
                        kind = str(item.get("type") or "invalid")
                        attr = item.get("attribute")
                        value = attr.get("value") if isinstance(attr, dict) else None
                        texts.append(f"{kind} {value}" if value is not None else kind)
                    else:
                        texts.append(str(item))
                errors[str(name)] = texts
        if status >= 500 and "unexpected" in message.lower():
            message = f"{message} (check the Carrybee credentials)"
    elif isinstance(body, str) and body:
        message = f"{message} ({status}): {body[:200]}"
    raise CarrybeeError(message, status=status, field_errors=errors)


async def _call(cfg: CarrybeeConfig, method: str, path: str, body: Any | None = None) -> Any:
    if not cfg.configured:
        raise CarrybeeError("Carrybee is not configured for this store")
    try:
        status, data = await asyncio.to_thread(_request_sync, cfg, method, path, body)
    except requests.RequestException as exc:
        raise CarrybeeError(f"Could not reach Carrybee: {exc}") from exc
    if 200 <= status < 300 and not (isinstance(data, dict) and data.get("error") is True):
        return data
    _raise_for(status, data)


def _data(body: Any) -> dict[str, Any]:
    data = body.get("data") if isinstance(body, dict) else None
    return data if isinstance(data, dict) else {}


# --- Public operations ------------------------------------------------------


async def create_order(order: Order, cfg: CarrybeeConfig, order_no: str) -> Consignment:
    """Book one parcel with the order's store's credentials. Raises
    CarrybeeError with field errors when our data doesn't pass Carrybee's
    checks, and on any transport or credential failure."""
    payload = build_order_payload(order, cfg, order_no)
    body = await _call(cfg, "POST", "orders", payload)
    data = _data(body).get("order")
    if not isinstance(data, dict) or not data.get("consignment_id"):
        raise CarrybeeError("Carrybee replied without a consignment id")
    return Consignment(
        consignment_id=str(data["consignment_id"]),
        # A new parcel waits to be picked up; Carrybee's own first status.
        status="pickup-requested",
        delivery_fee=money(data.get("delivery_fee")),
        raw=data,
    )


async def order_details(cfg: CarrybeeConfig, consignment_id: str) -> Consignment:
    body = await _call(cfg, "GET", f"orders/{consignment_id}/details")
    data = _data(body)
    if not data:
        raise CarrybeeError("Carrybee replied without the order")
    return Consignment(
        consignment_id=str(data.get("consignment_id") or consignment_id),
        status=normalise_status(data.get("transfer_status")),
        delivery_fee=money(data.get("delivery_fee")),
        status_at=parse_time(data.get("updated_at")),
        raw=data,
    )


async def list_stores(cfg: CarrybeeConfig) -> list[dict[str, Any]]:
    """The merchant's pickup stores, trimmed to what staff choose by."""
    body = await _call(cfg, "GET", "stores")
    stores = _data(body).get("stores")
    out = []
    for row in stores if isinstance(stores, list) else []:
        if not isinstance(row, dict) or row.get("id") is None:
            continue
        out.append(
            {
                "id": str(row["id"]),
                "name": str(row.get("name") or ""),
                "address": str(row.get("address") or ""),
                "status": str(row.get("status") or ""),
                "is_active": bool(row.get("is_active", True)),
                "is_default_pickup_store": bool(row.get("is_default_pickup_store")),
            }
        )
    return out


def is_rate_limited(exc: CarrybeeError) -> bool:
    return exc.status == 429


def error_text(exc: CarrybeeError) -> str:
    """One line for staff: the message plus any per-field complaints."""
    if not exc.field_errors:
        return exc.message
    details = "; ".join(f"{name}: {' '.join(msgs)}" for name, msgs in exc.field_errors.items())
    return f"{exc.message} — {details}"
