"""Per-store integration settings: Meta Pixel / Conversions API, the
couriers (Pathao, Carrybee), BDCourier. Edited from the store's own Settings page by anyone with the
"settings" permission there (owners, and super admins everywhere). The store
in the path must be the one named by X-Admin-Store: the header is what the
membership check is made against, so the two can never disagree.

Secrets go in and never come out: the response says whether each is set and
its last characters. In the update, a secret field left out (None) keeps the
stored value, "" clears it, anything else replaces it.
"""
import secrets
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import crypto, stores, tenancy
from api.auth import get_current_user
from api.config import settings as app_settings
from api.db import get_session
from api.models import Store, StoreSettings, User, UserRole
from api.schemas import CarrybeeStatusOut, PathaoStatusOut
from api.services import carrybee, pathao

router = APIRouter(prefix="/stores", tags=["Stores"])


async def settings_store(
    store_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> tenancy.StoreContext:
    """The store whose settings are being edited.

    A super admin edits any store straight from the platform's Stores page,
    so the path decides and X-Admin-Store is not consulted. Everyone else
    needs the "settings" permission in the store they are working in, and
    that store must be the one in the path: the header is what the
    membership check is made against, so the two can never disagree.
    """
    if tenancy.is_super_admin(user):
        store = await stores.resolve_id(session, store_id)
        if store is None:
            raise HTTPException(status_code=404, detail="Unknown store")
        return tenancy.StoreContext(store=store, role=UserRole.super_admin.value, user=user)
    ctx = await tenancy.admin_store(request, user, session)
    if not ctx.can("settings"):
        raise HTTPException(status_code=403, detail="Your role in this store cannot do this")
    if ctx.store.id != store_id:
        raise HTTPException(status_code=403, detail="Switch to this store first")
    return ctx

ItemType = Literal["document", "parcel", "fragile"]
# Carrybee's product types: 1 parcel, 2 book, 3 document.
CarrybeeProductType = Literal[1, 2, 3]

WEBHOOK_PATH = "/api/webhooks/carrybee/"
PATHAO_WEBHOOK_PATH = "/api/webhooks/pathao/"


class StoreSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meta_pixel_id: str
    meta_test_event_code: str
    meta_capi_token_set: bool
    meta_capi_token_hint: str | None
    pathao_client_id: str
    pathao_client_secret_set: bool
    pathao_client_secret_hint: str | None
    pathao_email: str
    pathao_password_set: bool
    pathao_store_id: int | None
    pathao_item_type: str
    pathao_enabled: bool
    pathao_parcel_weight_kg: Decimal
    pathao_webhook_secret_set: bool
    pathao_webhook_secret_hint: str | None
    # Where Pathao should post status changes, like carrybee_webhook_path.
    pathao_webhook_path: str | None
    pathao_integration_header: str
    carrybee_enabled: bool
    carrybee_client_id: str
    carrybee_client_secret_set: bool
    carrybee_client_secret_hint: str | None
    carrybee_client_context_set: bool
    carrybee_client_context_hint: str | None
    carrybee_store_id: str
    carrybee_product_type: int
    carrybee_item_weight_g: int
    carrybee_webhook_secret_set: bool
    carrybee_webhook_secret_hint: str | None
    # Where Carrybee should post status changes, relative to the admin's own
    # origin; null until Carrybee is first switched on.
    carrybee_webhook_path: str | None
    carrybee_integration_header: str
    carrybee_sandbox: bool
    bdcourier_api_key_set: bool
    bdcourier_api_key_hint: str | None
    encryption_available: bool
    pathao_sharing: "CourierSharing" = Field(default_factory=lambda: CourierSharing())
    carrybee_sharing: "CourierSharing" = Field(default_factory=lambda: CourierSharing())


class LinkedStore(BaseModel):
    store_id: int
    name: str


class CourierSharing(BaseModel):
    """Who shares this store's courier account, as the Settings page shows
    it. `options` and `same_credentials` name other stores, so they are
    filled for super admins only; everyone with "settings" sees the links
    that affect their own store."""

    # The store whose account this one uses; null when it has its own.
    account: LinkedStore | None = None
    # Stores using this store's account (its webhook serves them too).
    shared_with: list[LinkedStore] = Field(default_factory=list)
    # Super admins only: whether this store may be linked now, the stores it
    # may be linked to, and unlinked stores holding the same client id — the
    # case linking exists for.
    can_link: bool = False
    options: list[LinkedStore] = Field(default_factory=list)
    same_credentials: list[LinkedStore] = Field(default_factory=list)


class CourierAccountIn(BaseModel):
    courier: Literal["pathao", "carrybee"]
    # The store whose account to use; null to go back to this store's own.
    account_store_id: int | None = None


StoreSettingsOut.model_rebuild()


class StoreSettingsUpdate(BaseModel):
    meta_pixel_id: str = Field(default="", max_length=40)
    meta_capi_token: str | None = Field(default=None, max_length=1000)
    meta_test_event_code: str = Field(default="", max_length=40)
    pathao_client_id: str = Field(default="", max_length=120)
    pathao_client_secret: str | None = Field(default=None, max_length=500)
    pathao_email: str = Field(default="", max_length=255)
    pathao_password: str | None = Field(default=None, max_length=500)
    pathao_store_id: int | None = Field(default=None, ge=0)
    pathao_item_type: ItemType = "parcel"
    # None keeps the current switch, so a client that predates it never
    # switches a courier off by leaving the field out.
    pathao_enabled: bool | None = None
    pathao_parcel_weight_kg: Decimal = Field(default=Decimal("1"), ge=Decimal("0.5"), le=Decimal("10"))
    pathao_webhook_secret: str | None = Field(default=None, max_length=500)
    pathao_integration_header: str = Field(default="", max_length=100)
    carrybee_enabled: bool | None = None
    carrybee_client_id: str = Field(default="", max_length=120)
    carrybee_client_secret: str | None = Field(default=None, max_length=500)
    carrybee_client_context: str | None = Field(default=None, max_length=500)
    carrybee_store_id: str = Field(default="", max_length=40, pattern=r"^\d*$")
    carrybee_product_type: CarrybeeProductType = 1
    carrybee_item_weight_g: int = Field(default=500, ge=1, le=25_000)
    carrybee_webhook_secret: str | None = Field(default=None, max_length=500)
    carrybee_integration_header: str = Field(default="", max_length=100)
    bdcourier_api_key: str | None = Field(default=None, max_length=500)


def redact(
    row: StoreSettings | None,
    *,
    pathao_account: StoreSettings | None = None,
    carrybee_account: StoreSettings | None = None,
) -> StoreSettingsOut:
    """What the admin may see. Decrypts only to compute the hints. A store
    sharing another's courier account (`*_account`) shows that account's
    credentials and webhook: they are the ones in use."""
    ok = crypto.available()

    def peek(blob: bytes | None) -> tuple[bool, str | None]:
        if blob is None:
            return False, None
        if not ok:
            return True, None
        try:
            return True, crypto.hint(crypto.decrypt(blob))
        except crypto.InvalidToken:
            # Encrypted under a key that is no longer configured.
            return True, "?"

    if row is None:
        return StoreSettingsOut(
            meta_pixel_id="", meta_test_event_code="",
            meta_capi_token_set=False, meta_capi_token_hint=None,
            pathao_client_id="", pathao_client_secret_set=False, pathao_client_secret_hint=None,
            pathao_email="", pathao_password_set=False, pathao_store_id=None,
            pathao_item_type="parcel", pathao_enabled=False,
            pathao_parcel_weight_kg=Decimal("1"),
            pathao_webhook_secret_set=False, pathao_webhook_secret_hint=None,
            pathao_webhook_path=None, pathao_integration_header="",
            carrybee_enabled=False, carrybee_client_id="",
            carrybee_client_secret_set=False, carrybee_client_secret_hint=None,
            carrybee_client_context_set=False, carrybee_client_context_hint=None,
            carrybee_store_id="", carrybee_product_type=1, carrybee_item_weight_g=500,
            carrybee_webhook_secret_set=False, carrybee_webhook_secret_hint=None,
            carrybee_webhook_path=None, carrybee_integration_header="",
            carrybee_sandbox=carrybee.is_sandbox(),
            bdcourier_api_key_set=False, bdcourier_api_key_hint=None,
            encryption_available=ok,
        )
    p = pathao_account or row
    c = carrybee_account or row
    capi = peek(row.meta_capi_token_enc)
    secret = peek(p.pathao_client_secret_enc)
    fraud = peek(row.bdcourier_api_key_enc)
    cb_secret = peek(c.carrybee_client_secret_enc)
    cb_context = peek(c.carrybee_client_context_enc)
    cb_webhook = peek(c.carrybee_webhook_secret_enc)
    p_webhook = peek(p.pathao_webhook_secret_enc)
    return StoreSettingsOut(
        meta_pixel_id=row.meta_pixel_id,
        meta_test_event_code=row.meta_test_event_code,
        meta_capi_token_set=capi[0],
        meta_capi_token_hint=capi[1],
        pathao_client_id=p.pathao_client_id,
        pathao_client_secret_set=secret[0],
        pathao_client_secret_hint=secret[1],
        pathao_email=p.pathao_email,
        pathao_password_set=p.pathao_password_enc is not None,
        pathao_store_id=row.pathao_store_id,
        pathao_item_type=row.pathao_item_type,
        pathao_enabled=row.pathao_enabled,
        pathao_parcel_weight_kg=row.pathao_parcel_weight_kg,
        pathao_webhook_secret_set=p_webhook[0],
        pathao_webhook_secret_hint=p_webhook[1],
        pathao_webhook_path=(
            PATHAO_WEBHOOK_PATH + p.pathao_webhook_token if p.pathao_webhook_token else None
        ),
        pathao_integration_header=p.pathao_integration_header,
        carrybee_enabled=row.carrybee_enabled,
        carrybee_client_id=c.carrybee_client_id,
        carrybee_client_secret_set=cb_secret[0],
        carrybee_client_secret_hint=cb_secret[1],
        carrybee_client_context_set=cb_context[0],
        carrybee_client_context_hint=cb_context[1],
        carrybee_store_id=row.carrybee_store_id,
        carrybee_product_type=row.carrybee_product_type,
        carrybee_item_weight_g=row.carrybee_item_weight_g,
        carrybee_webhook_secret_set=cb_webhook[0],
        carrybee_webhook_secret_hint=cb_webhook[1],
        carrybee_webhook_path=(
            WEBHOOK_PATH + c.carrybee_webhook_token if c.carrybee_webhook_token else None
        ),
        carrybee_integration_header=c.carrybee_integration_header,
        carrybee_sandbox=carrybee.is_sandbox(),
        bdcourier_api_key_set=fraud[0],
        bdcourier_api_key_hint=fraud[1],
        encryption_available=ok,
    )


def apply_secret(current: bytes | None, incoming: str | None) -> bytes | None:
    """None keeps, "" clears, text replaces (encrypted). Surrounding
    whitespace is dropped: a trailing newline from a paste is not part of
    any token or password, and Pathao answers it with a bare 400."""
    if incoming is None:
        return current
    incoming = incoming.strip()
    if incoming == "":
        return None
    return crypto.encrypt(incoming)


COURIERS = ("pathao", "carrybee")


def _account_column(courier: str):
    return getattr(StoreSettings, f"{courier}_account_store_id")


def _client_id_column(courier: str):
    return getattr(StoreSettings, f"{courier}_client_id")


async def _stores_where(session: AsyncSession, *conditions) -> list[LinkedStore]:
    rows = await session.execute(
        select(Store.id, Store.name)
        .join(StoreSettings, StoreSettings.store_id == Store.id)
        .where(*conditions)
        .order_by(Store.name)
    )
    return [LinkedStore(store_id=sid, name=name) for sid, name in rows]


async def _sharing(
    session: AsyncSession, store_id: int, row: StoreSettings | None, courier: str, super_admin: bool
) -> CourierSharing:
    account_id = getattr(row, f"{courier}_account_store_id", None) if row else None
    out = CourierSharing()
    if account_id is not None:
        store = await session.get(Store, account_id)
        out.account = LinkedStore(store_id=account_id, name=store.name if store else f"#{account_id}")
    out.shared_with = await _stores_where(session, _account_column(courier) == store_id)
    if not super_admin:
        return out
    # A store others use cannot itself point elsewhere: no chains.
    out.can_link = not out.shared_with
    out.options = await _stores_where(
        session,
        Store.id != store_id,
        _client_id_column(courier) != "",
        _account_column(courier).is_(None),
    )
    client_id = getattr(row, f"{courier}_client_id", "") if row else ""
    if client_id and account_id is None:
        out.same_credentials = await _stores_where(
            session,
            Store.id != store_id,
            _client_id_column(courier) == client_id,
            _account_column(courier).is_(None),
        )
    return out


async def settings_out(
    session: AsyncSession, store_id: int, row: StoreSettings | None, ctx: tenancy.StoreContext
) -> StoreSettingsOut:
    """redact() with the linked accounts' rows and the sharing summary."""
    accounts: dict[str, StoreSettings | None] = {}
    for courier in COURIERS:
        account_id = getattr(row, f"{courier}_account_store_id", None) if row else None
        if account_id is not None:
            accounts[f"{courier}_account"] = await session.get(StoreSettings, account_id)
    out = redact(row, **accounts)
    super_admin = ctx.role == UserRole.super_admin.value
    out.pathao_sharing = await _sharing(session, store_id, row, "pathao", super_admin)
    out.carrybee_sharing = await _sharing(session, store_id, row, "carrybee", super_admin)
    return out


@router.get("/{store_id}/settings", response_model=StoreSettingsOut)
async def get_settings(
    store_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreSettingsOut:
    row = await session.get(StoreSettings, ctx.store.id)
    return await settings_out(session, ctx.store.id, row, ctx)


@router.put("/{store_id}/settings/courier-account", response_model=StoreSettingsOut)
async def put_courier_account(
    store_id: int,
    payload: CourierAccountIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreSettingsOut:
    """Point this store at another store's courier account, or back to its
    own. Super admins only: it hands one store the use of another's courier
    credentials. The store's own saved credentials are kept, unused, so
    going back needs nothing re-typed."""
    if ctx.role != UserRole.super_admin.value:
        raise HTTPException(status_code=403, detail="Only a super admin can link courier accounts")
    courier = payload.courier
    column = _account_column(courier)
    row = await session.get(StoreSettings, store_id)
    if row is None:
        row = StoreSettings(store_id=store_id)
        session.add(row)
        await session.flush()
    target = payload.account_store_id
    if target is not None:
        if target == store_id:
            raise HTTPException(status_code=400, detail="A store cannot use its own account")
        source = await session.get(StoreSettings, target)
        if source is None or not getattr(source, f"{courier}_client_id"):
            raise HTTPException(status_code=400, detail="That store has no account of its own to share")
        if getattr(source, f"{courier}_account_store_id") is not None:
            raise HTTPException(status_code=400, detail="That store itself uses another store's account")
        users = (
            await session.scalars(select(StoreSettings.store_id).where(column == store_id))
        ).all()
        if users:
            raise HTTPException(
                status_code=400,
                detail="Other stores use this store's account; move them first",
            )
    setattr(row, f"{courier}_account_store_id", target)
    # Back on its own account: it needs its own webhook URL again.
    if target is None and getattr(row, f"{courier}_enabled") and not getattr(
        row, f"{courier}_webhook_token"
    ):
        setattr(row, f"{courier}_webhook_token", secrets.token_urlsafe(24))
    await session.commit()
    await session.refresh(row)
    stores.invalidate()
    return await settings_out(session, store_id, row, ctx)


@router.put("/{store_id}/settings", response_model=StoreSettingsOut)
async def put_settings(
    store_id: int,
    payload: StoreSettingsUpdate,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreSettingsOut:
    wants_secret = any(
        v for v in (
            payload.meta_capi_token, payload.pathao_client_secret,
            payload.pathao_password, payload.bdcourier_api_key,
            payload.carrybee_client_secret, payload.carrybee_client_context,
            payload.carrybee_webhook_secret, payload.pathao_webhook_secret,
        )
    )
    if wants_secret and not crypto.available():
        raise HTTPException(
            status_code=503,
            detail="APP_ENCRYPTION_KEY is not configured on the server; secrets cannot be saved",
        )
    row = await session.get(StoreSettings, store_id)
    if row is None:
        row = StoreSettings(store_id=store_id)
        session.add(row)
    row.meta_pixel_id = payload.meta_pixel_id.strip()
    row.meta_test_event_code = payload.meta_test_event_code.strip()
    row.meta_capi_token_enc = apply_secret(row.meta_capi_token_enc, payload.meta_capi_token)
    # A store using another store's courier account cannot change that
    # account from here: its credentials and webhook belong to the other
    # store's Settings. The page shows them read-only and sends them back
    # unchanged; they are ignored.
    if row.pathao_account_store_id is None:
        row.pathao_client_id = payload.pathao_client_id.strip()
        row.pathao_client_secret_enc = apply_secret(
            row.pathao_client_secret_enc, payload.pathao_client_secret
        )
        row.pathao_email = payload.pathao_email.strip().lower()
        row.pathao_password_enc = apply_secret(row.pathao_password_enc, payload.pathao_password)
        row.pathao_webhook_secret_enc = apply_secret(
            row.pathao_webhook_secret_enc, payload.pathao_webhook_secret
        )
        row.pathao_integration_header = payload.pathao_integration_header.strip()
    row.pathao_store_id = payload.pathao_store_id
    row.pathao_item_type = payload.pathao_item_type
    row.pathao_parcel_weight_kg = payload.pathao_parcel_weight_kg
    if payload.pathao_enabled is not None:
        row.pathao_enabled = payload.pathao_enabled
    if payload.carrybee_enabled is not None:
        row.carrybee_enabled = payload.carrybee_enabled
    if row.carrybee_account_store_id is None:
        row.carrybee_client_id = payload.carrybee_client_id.strip()
        row.carrybee_client_secret_enc = apply_secret(
            row.carrybee_client_secret_enc, payload.carrybee_client_secret
        )
        row.carrybee_client_context_enc = apply_secret(
            row.carrybee_client_context_enc, payload.carrybee_client_context
        )
        row.carrybee_webhook_secret_enc = apply_secret(
            row.carrybee_webhook_secret_enc, payload.carrybee_webhook_secret
        )
        row.carrybee_integration_header = payload.carrybee_integration_header.strip()
    row.carrybee_store_id = payload.carrybee_store_id.strip()
    row.carrybee_product_type = payload.carrybee_product_type
    row.carrybee_item_weight_g = payload.carrybee_item_weight_g
    # The webhook URL exists from the first time a courier is switched on,
    # and then never changes: it is pasted into the courier's panel once. A
    # store on another's account uses that account's URL instead.
    own_carrybee = row.carrybee_account_store_id is None
    if row.carrybee_enabled and own_carrybee and not row.carrybee_webhook_token:
        row.carrybee_webhook_token = secrets.token_urlsafe(24)
    own_pathao = row.pathao_account_store_id is None
    if row.pathao_enabled and own_pathao and not row.pathao_webhook_token:
        row.pathao_webhook_token = secrets.token_urlsafe(24)
    row.bdcourier_api_key_enc = apply_secret(row.bdcourier_api_key_enc, payload.bdcourier_api_key)
    await session.commit()
    await session.refresh(row)
    # Services read a cached, decrypted copy; drop it so the change is live.
    stores.invalidate()
    return await settings_out(session, store_id, row, ctx)


@router.post("/{store_id}/settings/pathao-test", response_model=PathaoStatusOut)
async def test_pathao(
    store_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> PathaoStatusOut:
    """
    Log in to Pathao with the store's *saved* credentials and list the
    merchant stores they can see, so the Pathao store id can be copied rather
    than guessed. Unsaved edits are not tested: save first. A stale cached
    copy is dropped so the test reflects what was just saved.
    """
    stores.invalidate()
    integrations = await stores.load_integrations(session, ctx.store.id)
    cfg = integrations.pathao if integrations else stores.PathaoConfig()
    out = PathaoStatusOut(
        enabled=cfg.configured,
        sandbox=pathao.is_sandbox(),
        base_url=app_settings.pathao_base_url,
        store_id=cfg.store_id,
        unit_weight_kg=cfg.unit_weight_kg,
    )
    if not cfg.configured:
        missing = [
            name
            for name, value in (
                ("client id", cfg.client_id),
                ("client secret", cfg.client_secret),
                ("client email", cfg.username),
                ("password", cfg.password),
                ("store id", cfg.store_id),
            )
            if not value
        ]
        out.error = "Missing: " + ", ".join(missing)
        return out
    try:
        # force=True: a test must prove the credentials work now, not that a
        # token from last week is still cached.
        await pathao.get_access_token(cfg, ctx.store.id, force=True)
        out.stores = await pathao.list_stores(cfg, ctx.store.id)
    except pathao.PathaoError as exc:
        out.error = pathao.error_text(exc)
    return out


@router.post("/{store_id}/settings/carrybee-test", response_model=CarrybeeStatusOut)
async def test_carrybee(
    store_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> CarrybeeStatusOut:
    """
    Call Carrybee with the store's *saved* credentials and list the pickup
    stores they can see, so the store id can be picked rather than guessed.
    Only the id, secret and context are needed for the test; the pickup store
    is what it helps choose. Unsaved edits are not tested: save first.
    """
    stores.invalidate()
    integrations = await stores.load_integrations(session, ctx.store.id)
    cfg = integrations.carrybee if integrations else stores.CarrybeeConfig()
    out = CarrybeeStatusOut(
        configured=cfg.configured,
        sandbox=carrybee.is_sandbox(),
        base_url=app_settings.carrybee_base_url,
        store_id=cfg.store_id,
    )
    missing = [
        name
        for name, value in (
            ("client id", cfg.client_id),
            ("client secret", cfg.client_secret),
            ("client context", cfg.client_context),
        )
        if not value
    ]
    if missing:
        out.error = "Missing: " + ", ".join(missing)
        return out
    try:
        # list_stores refuses an unconfigured config; the pickup store may be
        # what this test is for, so ask with a stand-in for it.
        probe = cfg if cfg.store_id else stores.CarrybeeConfig(
            client_id=cfg.client_id,
            client_secret=cfg.client_secret,
            client_context=cfg.client_context,
            store_id="-",
        )
        out.stores = await carrybee.list_stores(probe)
    except carrybee.CarrybeeError as exc:
        out.error = carrybee.error_text(exc)
    return out
