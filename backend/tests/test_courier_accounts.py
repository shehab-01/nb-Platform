"""Stores sharing one courier account: credentials and webhook come from the
account's store, the switch and parcel defaults stay the store's own.

Run from backend/:  python -m pytest tests -q
"""
from decimal import Decimal
from types import SimpleNamespace

from cryptography.fernet import Fernet

from api import crypto
from api.routers.store_settings import redact
from api.stores import integrations_from


def _row(store_id: int, **kw) -> SimpleNamespace:
    defaults = dict(
        store_id=store_id,
        meta_pixel_id="", meta_capi_token_enc=None, meta_test_event_code="",
        pathao_client_id="", pathao_client_secret_enc=None, pathao_email="",
        pathao_password_enc=None, pathao_store_id=None, pathao_item_type="parcel",
        pathao_parcel_weight_kg=Decimal("1"), pathao_enabled=False,
        pathao_webhook_secret_enc=None, pathao_webhook_token=None, pathao_integration_header="",
        pathao_account_store_id=None,
        carrybee_enabled=False, carrybee_client_id="", carrybee_client_secret_enc=None,
        carrybee_client_context_enc=None, carrybee_store_id="", carrybee_product_type=1,
        carrybee_item_weight_g=500, carrybee_webhook_secret_enc=None, carrybee_webhook_token=None,
        carrybee_integration_header="", carrybee_account_store_id=None,
        bdcourier_api_key_enc=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _owner() -> SimpleNamespace:
    return _row(
        3,
        pathao_client_id="pid", pathao_client_secret_enc=crypto.encrypt("psecret"),
        pathao_email="ops@nb.shop", pathao_password_enc=crypto.encrypt("pw"),
        pathao_store_id=111, pathao_enabled=True, pathao_parcel_weight_kg=Decimal("1"),
        pathao_webhook_secret_enc=crypto.encrypt("phook0001"), pathao_webhook_token="ptok",
        pathao_integration_header="f3992ecc",
        carrybee_enabled=True, carrybee_client_id="cid",
        carrybee_client_secret_enc=crypto.encrypt("csecret"),
        carrybee_client_context_enc=crypto.encrypt("cctx"), carrybee_store_id="3753",
        carrybee_webhook_secret_enc=crypto.encrypt("chook0002"), carrybee_webhook_token="ctok",
        carrybee_integration_header="40489fe0",
    )


def _linked() -> SimpleNamespace:
    # Its own (stale) credentials stay saved but must not be used.
    return _row(
        5,
        pathao_client_id="old", pathao_store_id=222, pathao_enabled=True,
        pathao_parcel_weight_kg=Decimal("2"), pathao_account_store_id=3,
        carrybee_enabled=True, carrybee_client_id="old", carrybee_store_id="9999",
        carrybee_account_store_id=3,
    )


def test_linked_store_uses_the_accounts_credentials_and_its_own_defaults(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    owner, linked = _owner(), _linked()
    got = integrations_from(
        SimpleNamespace(id=5, order_prefix="EC"), linked,  # type: ignore[arg-type]
        pathao_account=owner, carrybee_account=owner,  # type: ignore[arg-type]
    )
    assert got.pathao.client_id == "pid" and got.pathao.password == "pw"
    assert got.pathao.webhook_secret == "phook0001" and got.pathao.webhook_token == "ptok"
    # Pickup store and weight are the linked store's own.
    assert got.pathao.store_id == 222 and got.pathao.unit_weight_kg == 2.0
    # One account, one login token: the owner's.
    assert got.pathao.account_store_id == 3
    assert got.carrybee.client_secret == "csecret" and got.carrybee.store_id == "9999"
    assert got.carrybee.webhook_secret == "chook0002" and got.carrybee.account_store_id == 3
    assert got.couriers() == ["pathao", "carrybee"]


def test_own_account_has_no_account_store(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    got = integrations_from(SimpleNamespace(id=3, order_prefix="NB"), _owner())  # type: ignore[arg-type]
    assert got.pathao.account_store_id is None and got.carrybee.account_store_id is None


def test_linked_settings_show_the_accounts_webhook_never_its_secrets(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    owner = _owner()
    out = redact(_linked(), pathao_account=owner, carrybee_account=owner)  # type: ignore[arg-type]
    assert out.pathao_webhook_path == "/api/webhooks/pathao/ptok"
    assert out.carrybee_webhook_path == "/api/webhooks/carrybee/ctok"
    assert out.pathao_client_id == "pid" and out.pathao_store_id == 222
    assert out.pathao_webhook_secret_hint == "0001"
    dumped = out.model_dump_json()
    for secret in ("psecret", "phook0001", "csecret", "cctx", "chook0002"):
        assert secret not in dumped
