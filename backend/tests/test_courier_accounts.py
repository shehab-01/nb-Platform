"""Courier accounts: credentials and webhook come from the account a store
picks; the switch and parcel defaults stay the store's own. Two stores on
one account get the same credentials and the same webhook.

Run from backend/:  python -m pytest tests -q
"""
from decimal import Decimal
from types import SimpleNamespace

from cryptography.fernet import Fernet

from api import crypto
from api.models import CourierAccount
from api.routers.courier_accounts import AccountStore, redact as redact_account
from api.routers.store_settings import redact
from api.stores import integrations_from, pathao_config


def _row(store_id: int, **kw) -> SimpleNamespace:
    defaults = dict(
        store_id=store_id,
        meta_pixel_id="", meta_capi_token_enc=None, meta_test_event_code="",
        pathao_courier_account_id=None, pathao_store_id=None, pathao_item_type="parcel",
        pathao_parcel_weight_kg=Decimal("1"), pathao_enabled=False,
        carrybee_courier_account_id=None, carrybee_enabled=False, carrybee_store_id="",
        carrybee_product_type=1, carrybee_item_weight_g=500,
        bdcourier_api_key_enc=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _pathao() -> CourierAccount:
    return CourierAccount(
        id=7, courier="pathao", name="NB Pathao", client_id="pid",
        client_secret_enc=crypto.encrypt("psecret"), username="ops@nb.shop",
        password_enc=crypto.encrypt("pw"), webhook_token="ptok",
        webhook_secret_enc=crypto.encrypt("phook0001"), integration_header="f3992ecc",
    )


def _carrybee() -> CourierAccount:
    return CourierAccount(
        id=8, courier="carrybee", name="NB Carrybee", client_id="cid", username="",
        client_secret_enc=crypto.encrypt("csecret"), client_context_enc=crypto.encrypt("cctx"),
        webhook_token="ctok", webhook_secret_enc=crypto.encrypt("chook0002"),
        integration_header="40489fe0",
    )


def test_two_stores_on_one_account_share_it_and_keep_their_own_details(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    pathao, carrybee = _pathao(), _carrybee()
    nb = _row(3, pathao_courier_account_id=7, pathao_store_id=111, pathao_enabled=True,
              carrybee_courier_account_id=8, carrybee_store_id="3753", carrybee_enabled=True)
    eco = _row(5, pathao_courier_account_id=7, pathao_store_id=222, pathao_enabled=True,
               pathao_parcel_weight_kg=Decimal("2"),
               carrybee_courier_account_id=8, carrybee_store_id="9999", carrybee_enabled=True)
    a = integrations_from(SimpleNamespace(id=3, order_prefix="NB"), nb,  # type: ignore[arg-type]
                          pathao_account=pathao, carrybee_account=carrybee)
    b = integrations_from(SimpleNamespace(id=5, order_prefix="EC"), eco,  # type: ignore[arg-type]
                          pathao_account=pathao, carrybee_account=carrybee)
    for got in (a, b):
        assert got.pathao.client_id == "pid" and got.pathao.password == "pw"
        assert got.pathao.webhook_secret == "phook0001" and got.pathao.account_id == 7
        assert got.carrybee.client_secret == "csecret" and got.carrybee.webhook_token == "ctok"
        assert got.couriers() == ["pathao", "carrybee"]
    # Pickup store and weight stay each store's own.
    assert (a.pathao.store_id, b.pathao.store_id) == (111, 222)
    assert b.pathao.unit_weight_kg == 2.0
    assert (a.carrybee.store_id, b.carrybee.store_id) == ("3753", "9999")


def test_no_account_means_not_configured(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    got = integrations_from(
        SimpleNamespace(id=3, order_prefix="NB"),  # type: ignore[arg-type]
        _row(3, pathao_store_id=111, pathao_enabled=True, carrybee_enabled=True),
    )
    assert got.couriers() == []
    assert got.pathao.account_id is None and not got.pathao.configured


def test_account_alone_can_be_tested_without_a_store(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    cfg = pathao_config(_pathao(), None)
    # A stand-in pickup store, so the login and store list can run.
    assert cfg.configured and not cfg.enabled


def test_store_settings_show_the_account_never_its_secrets(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    out = redact(
        _row(5, pathao_store_id=222, pathao_courier_account_id=7),  # type: ignore[arg-type]
        pathao_account=_pathao(), carrybee_account=_carrybee(),
    )
    assert out.pathao_account is not None and out.pathao_account.name == "NB Pathao"
    assert out.pathao_account.webhook_path == "/api/webhooks/pathao/ptok"
    assert out.carrybee_account is not None
    assert out.carrybee_account.webhook_path == "/api/webhooks/carrybee/ctok"
    assert out.pathao_store_id == 222
    dumped = out.model_dump_json()
    for secret in ("psecret", "pw\"", "phook0001", "csecret", "cctx", "chook0002"):
        assert secret not in dumped


def test_account_page_shows_hints_only(monkeypatch):
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
    out = redact_account(_pathao(), [AccountStore(store_id=3, name="Nature Bazar")])
    assert out.client_secret_set and out.client_secret_hint == "cret"
    assert out.webhook_secret_hint == "0001" and out.password_set
    assert out.used_by[0].name == "Nature Bazar"
    dumped = out.model_dump_json()
    for secret in ("psecret", "phook0001"):
        assert secret not in dumped
