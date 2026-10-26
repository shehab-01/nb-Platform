"""Carrybee: payloads, status words, webhook signatures, per-store config.

Run from backend/:  python -m pytest tests -q
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from api import crypto
from api.models import Order, OrderItem
from api.routers.webhooks import describe_signature, hmac_ok, signature_ok
from api.services import carrybee, courier
from api.services.carrybee_sync import apply_status
from api.stores import CarrybeeConfig, PathaoConfig, integrations_from

CFG = CarrybeeConfig(
    client_id="id", client_secret="secret", client_context="ctx", store_id="3753",
    product_type=1, unit_weight_g=400,
)


def _order(**kw) -> Order:
    defaults = dict(
        id=42, store_id=1, customer_name="  Rahim   Uddin ", phone="+8801712345678",
        address="House 12, Road 5, Dhanmondi, Dhaka", quantity=2, total_amount=1450,
        product_name="Honey", comment="", items=[
            OrderItem(product_name="Honey 1kg", unit_price=700, quantity=2),
        ],
    )
    defaults.update(kw)
    return Order(**defaults)


class _Session:
    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


# --- payload ------------------------------------------------------------------


def test_payload_maps_order_to_carrybee_fields():
    body = carrybee.build_order_payload(_order(comment="Call\nfirst"), CFG, "NB-42")
    assert body["store_id"] == "3753"
    assert body["merchant_order_id"] == "NB-42"
    assert body["recipient_name"] == "Rahim Uddin"
    assert body["recipient_phone"] == "01712345678"
    assert body["delivery_type"] == 1 and body["product_type"] == 1
    assert body["item_weight"] == 800  # 400 g a unit, two units
    assert body["item_quantity"] == 2
    assert body["collectable_amount"] == 1450
    assert body["product_description"] == "Honey 1kg x2"
    assert body["special_instruction"] == "Call first"
    # No location ids: Carrybee places the parcel from the address itself.
    assert "city_id" not in body and "zone_id" not in body


def test_payload_weight_is_clamped_to_carrybee_range():
    heavy = CarrybeeConfig(**{**CFG.__dict__, "unit_weight_g": 20_000})
    assert carrybee.build_order_payload(_order(), heavy, "NB-1")["item_weight"] == 25_000


def test_payload_refuses_bad_details_with_field_errors():
    with pytest.raises(carrybee.CarrybeeError) as err:
        carrybee.build_order_payload(_order(phone="123", address="short"), CFG, "NB-1")
    assert set(err.value.field_errors) == {"recipient_phone", "recipient_address"}


# --- status words ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "slug"),
    [
        ("order.pickup-requested", "pickup-requested"),
        ("Pickup requested", "pickup-requested"),
        ("Returned To Merchant", "returned-to-merchant"),
        ("order.at-the-sorting-hub", "at-the-sorting-hub"),
        ("", None),
        (None, None),
    ],
)
def test_normalise_status(raw, slug):
    assert carrybee.normalise_status(raw) == slug


def test_courier_vocabulary():
    assert courier.is_settled("carrybee", "returned-to-merchant")
    assert not courier.is_settled("carrybee", "in-transit")
    assert courier.is_settled("pathao", "Delivered")
    # Anything returned is no longer in transit, for either courier.
    assert set(courier.RETURNED) <= set(courier.FINISHED)


def test_error_text_lists_causes():
    with pytest.raises(carrybee.CarrybeeError) as err:
        carrybee._raise_for(422, {
            "error": True, "message": "Validation error",
            "causes": {"recipient_address": [{"type": "min", "attribute": {"value": 10}}]},
        })
    assert carrybee.error_text(err.value) == "Validation error — recipient_address: min 10"


# --- applying statuses -------------------------------------------------------------


def test_apply_status_records_change_and_ignores_older_events():
    session = _Session()
    order = _order(courier_status="pickup-requested", courier_status_at=None)
    t1 = datetime(2026, 10, 18, 10, tzinfo=timezone.utc)

    assert apply_status(session, order, "in-transit", t1)  # type: ignore[arg-type]
    assert order.courier_status == "in-transit" and order.courier_status_at == t1
    assert session.added[-1].event_type == "carrybee_status"

    # An event that happened earlier, arriving late, changes nothing.
    assert not apply_status(session, order, "picked", t1 - timedelta(hours=1))  # type: ignore[arg-type]
    assert order.courier_status == "in-transit"

    # Same status again: no new audit event.
    count = len(session.added)
    assert not apply_status(session, order, "in-transit", t1 + timedelta(minutes=1))  # type: ignore[arg-type]
    assert len(session.added) == count


# --- webhook signature ---------------------------------------------------------------


def test_signature_matches_saved_secret_only():
    assert signature_ok("ecomsecret", "ecomsecret")
    assert signature_ok('"ecomsecret"', "ecomsecret")  # quoted, as in their example
    assert not signature_ok("wrong", "ecomsecret")
    assert not signature_ok(None, "ecomsecret")
    # No secret saved: nothing is trusted.
    assert not signature_ok("", "")


def test_hmac_signature_of_the_body_is_accepted():
    import base64
    import hashlib
    import hmac as _hmac

    body = b'{"event":"order.delivered","consignment_id":"CB1"}'
    digest = _hmac.new(b"ecomsecret", body, hashlib.sha256).digest()
    assert hmac_ok(digest.hex(), "ecomsecret", body)
    assert hmac_ok("sha256=" + digest.hex().upper(), "ecomsecret", body)
    assert hmac_ok(base64.b64encode(digest).decode(), "ecomsecret", body)
    assert not hmac_ok(digest.hex(), "other", body)
    assert not hmac_ok(digest.hex(), "ecomsecret", body + b" ")
    assert not hmac_ok(None, "ecomsecret", body)


def test_refusal_description_never_carries_values():
    headers = {"X-Carrybee-Webhook-Signature": "topsecret", "Content-Type": "application/json"}
    text = describe_signature(headers, "topsecret", "different")
    assert "topsecret" not in text and "different" not in text
    assert "X-Carrybee-Webhook-Signature" in text and "length 9" in text


# --- per-store config ------------------------------------------------------------------


def test_integrations_switches_and_couriers(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    row = SimpleNamespace(
        meta_pixel_id="", meta_capi_token_enc=None, meta_test_event_code="",
        pathao_client_id="", pathao_client_secret_enc=None, pathao_email="",
        pathao_password_enc=None, pathao_store_id=None, pathao_item_type="parcel",
        pathao_parcel_weight_kg=1, pathao_enabled=True,
        pathao_webhook_secret_enc=None, pathao_webhook_token="ptok",
        pathao_integration_header="",
        bdcourier_api_key_enc=None,
        carrybee_enabled=True, carrybee_client_id="id",
        carrybee_client_secret_enc=crypto.encrypt("s"),
        carrybee_client_context_enc=crypto.encrypt("c"),
        carrybee_store_id="3753", carrybee_product_type=1, carrybee_item_weight_g=500,
        carrybee_webhook_secret_enc=None, carrybee_webhook_token="tok",
        carrybee_integration_header="40489fe0",
    )
    store = SimpleNamespace(id=1, order_prefix="NB")
    got = integrations_from(store, row)  # type: ignore[arg-type]
    # Pathao is switched on but has no credentials, so it is not offered.
    assert got.couriers() == ["carrybee"]
    assert got.carrybee.client_secret == "s" and got.carrybee.webhook_token == "tok"
    assert got.carrybee.integration_header == "40489fe0"


def test_switched_off_courier_is_not_enabled():
    assert not CarrybeeConfig(**{**CFG.__dict__, "switched_on": False}).enabled
    assert CarrybeeConfig(**{**CFG.__dict__, "switched_on": False}).configured
    assert not PathaoConfig(switched_on=True).enabled
