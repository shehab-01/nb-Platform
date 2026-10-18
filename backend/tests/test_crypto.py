"""api.crypto and the settings redaction: secrets round-trip, rotate, and
never appear in a response.  Run from backend/: python -m pytest tests -q"""
from decimal import Decimal
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from api import crypto
from api.routers.store_settings import apply_secret, redact

K1 = Fernet.generate_key().decode()
K2 = Fernet.generate_key().decode()


def test_unavailable_without_key(monkeypatch):
    monkeypatch.delenv("APP_ENCRYPTION_KEY", raising=False)
    assert not crypto.available()
    with pytest.raises(crypto.EncryptionUnavailable):
        crypto.encrypt("x")


def test_malformed_key(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", "not-a-key")
    assert not crypto.available()


def test_roundtrip(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", K1)
    blob = crypto.encrypt("EAAB-token-1234")
    assert blob != b"EAAB-token-1234"
    assert crypto.decrypt(blob) == "EAAB-token-1234"
    assert crypto.decrypt(None) is None


def test_rotation_new_key_first_old_still_decrypts(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", K1)
    old = crypto.encrypt("secret")
    monkeypatch.setenv("APP_ENCRYPTION_KEY", f"{K2},{K1}")
    assert crypto.decrypt(old) == "secret"
    new = crypto.encrypt("secret")
    monkeypatch.setenv("APP_ENCRYPTION_KEY", K2)
    assert crypto.decrypt(new) == "secret"
    with pytest.raises(crypto.InvalidToken):
        crypto.decrypt(old)


def test_hint_never_reveals_short_values():
    assert crypto.hint(None) is None
    assert crypto.hint("") is None
    assert crypto.hint("abc") == "***"
    assert crypto.hint("abcdefgh") == "efgh"


def test_apply_secret_semantics(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", K1)
    kept = crypto.encrypt("keep")
    assert apply_secret(kept, None) is kept
    assert apply_secret(kept, "") is None
    assert crypto.decrypt(apply_secret(kept, "new")) == "new"


def test_redact_exposes_flags_and_hints_only(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", K1)
    row = SimpleNamespace(
        meta_pixel_id="123", meta_test_event_code="TEST1",
        meta_capi_token_enc=crypto.encrypt("EAABtoken9999"),
        pathao_client_id="cid", pathao_client_secret_enc=None,
        pathao_email="a@b.c", pathao_password_enc=crypto.encrypt("pw"),
        pathao_store_id=7, pathao_item_type="parcel",
        pathao_parcel_weight_kg=Decimal("1.5"), pathao_enabled=True,
        carrybee_enabled=True, carrybee_client_id="cb-id",
        carrybee_client_secret_enc=crypto.encrypt("cbsecret4321"),
        carrybee_client_context_enc=crypto.encrypt("cbcontext8765"),
        carrybee_store_id="3753", carrybee_product_type=1, carrybee_item_weight_g=500,
        carrybee_webhook_secret_enc=crypto.encrypt("hooksecret1111"),
        carrybee_webhook_token="tok123", carrybee_integration_header="40489fe0",
        bdcourier_api_key_enc=crypto.encrypt("courierkey0001"),
    )
    out = redact(row)  # type: ignore[arg-type]
    dumped = out.model_dump_json()
    assert "EAABtoken9999" not in dumped and "courierkey0001" not in dumped and '"pw"' not in dumped
    for secret in ("cbsecret4321", "cbcontext8765", "hooksecret1111"):
        assert secret not in dumped
    assert out.carrybee_client_secret_hint == "4321"
    assert out.carrybee_client_context_set and out.carrybee_webhook_secret_set
    assert out.carrybee_webhook_path == "/api/webhooks/carrybee/tok123"
    assert out.meta_capi_token_set and out.meta_capi_token_hint == "9999"
    assert not out.pathao_client_secret_set and out.pathao_client_secret_hint is None
    assert out.pathao_password_set
    assert out.bdcourier_api_key_hint == "0001"
    assert out.encryption_available


def test_redact_empty_defaults(monkeypatch):
    monkeypatch.delenv("APP_ENCRYPTION_KEY", raising=False)
    out = redact(None)
    assert out.pathao_item_type == "parcel"
    assert out.pathao_parcel_weight_kg == Decimal("1")
    assert not out.pathao_enabled and not out.carrybee_enabled
    assert out.carrybee_webhook_path is None
    assert not out.encryption_available
