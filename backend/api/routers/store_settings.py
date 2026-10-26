"""Per-store integration settings: Meta Pixel / Conversions API, the
couriers (Pathao, Carrybee), BDCourier. Edited from the store's own Settings
page by anyone with the "settings" permission there (owners, and super
admins everywhere). The store in the path must be the one named by
X-Admin-Store: the header is what the membership check is made against, so
the two can never disagree.

A courier's credentials and webhook belong to a courier account (Settings →
Courier, api.routers.courier_accounts), which several stores may share. The
store picks one — super admins only — and keeps its own switch and parcel
details (pickup store, weight, type).

Secrets go in and never come out: the response says whether each is set and
its last characters. In the update, a secret field left out (None) keeps the
stored value, "" clears it, anything else replaces it.
"""
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import crypto, stores, tenancy
from api.auth import get_current_user
from api.config import settings as app_settings
from api.db import get_session
from api.models import CourierAccount, StoreSettings, User, UserRole
from api.routers.courier_accounts import CourierAccountBrief, brief
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


class StoreSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meta_pixel_id: str
    meta_test_event_code: str
    meta_capi_token_set: bool
    meta_capi_token_hint: str | None
    # The courier account in use, as the page shows it; null when none is
    # picked yet (the courier cannot book until one is).
    pathao_account: CourierAccountBrief | None = None
    pathao_store_id: int | None
    pathao_item_type: str
    pathao_enabled: bool
    pathao_parcel_weight_kg: Decimal
    carrybee_account: CourierAccountBrief | None = None
    carrybee_enabled: bool
    carrybee_store_id: str
    carrybee_product_type: int
    carrybee_item_weight_g: int
    carrybee_sandbox: bool
    bdcourier_api_key_set: bool
    bdcourier_api_key_hint: str | None
    encryption_available: bool
    # Super admins pick the accounts; for them, every account to pick from.
    can_choose_accounts: bool = False
    account_options: list[CourierAccountBrief] = Field(default_factory=list)


class StoreSettingsUpdate(BaseModel):
    meta_pixel_id: str = Field(default="", max_length=40)
    meta_capi_token: str | None = Field(default=None, max_length=1000)
    meta_test_event_code: str = Field(default="", max_length=40)
    # Which courier account the store books through; null for none. Super
    # admins only, and only acted on when sent, so a store owner's save never
    # touches it.
    pathao_courier_account_id: int | None = None
    pathao_store_id: int | None = Field(default=None, ge=0)
    pathao_item_type: ItemType = "parcel"
    # None keeps the current switch, so a client that predates it never
    # switches a courier off by leaving the field out.
    pathao_enabled: bool | None = None
    pathao_parcel_weight_kg: Decimal = Field(default=Decimal("1"), ge=Decimal("0.5"), le=Decimal("10"))
    carrybee_courier_account_id: int | None = None
    carrybee_enabled: bool | None = None
    carrybee_store_id: str = Field(default="", max_length=40, pattern=r"^\d*$")
    carrybee_product_type: CarrybeeProductType = 1
    carrybee_item_weight_g: int = Field(default=500, ge=1, le=25_000)
    bdcourier_api_key: str | None = Field(default=None, max_length=500)


def redact(
    row: StoreSettings | None,
    *,
    pathao_account: CourierAccount | None = None,
    carrybee_account: CourierAccount | None = None,
) -> StoreSettingsOut:
    """What the admin may see. Decrypts only to compute the hints."""
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
            pathao_store_id=None, pathao_item_type="parcel", pathao_enabled=False,
            pathao_parcel_weight_kg=Decimal("1"),
            carrybee_enabled=False, carrybee_store_id="", carrybee_product_type=1,
            carrybee_item_weight_g=500, carrybee_sandbox=carrybee.is_sandbox(),
            bdcourier_api_key_set=False, bdcourier_api_key_hint=None,
            encryption_available=ok,
        )
    capi = peek(row.meta_capi_token_enc)
    fraud = peek(row.bdcourier_api_key_enc)
    return StoreSettingsOut(
        meta_pixel_id=row.meta_pixel_id,
        meta_test_event_code=row.meta_test_event_code,
        meta_capi_token_set=capi[0],
        meta_capi_token_hint=capi[1],
        pathao_account=brief(pathao_account) if pathao_account else None,
        pathao_store_id=row.pathao_store_id,
        pathao_item_type=row.pathao_item_type,
        pathao_enabled=row.pathao_enabled,
        pathao_parcel_weight_kg=row.pathao_parcel_weight_kg,
        carrybee_account=brief(carrybee_account) if carrybee_account else None,
        carrybee_enabled=row.carrybee_enabled,
        carrybee_store_id=row.carrybee_store_id,
        carrybee_product_type=row.carrybee_product_type,
        carrybee_item_weight_g=row.carrybee_item_weight_g,
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


async def settings_out(
    session: AsyncSession, row: StoreSettings | None, ctx: tenancy.StoreContext
) -> StoreSettingsOut:
    """redact() with the store's courier accounts and, for super admins,
    the accounts to choose from."""
    accounts: dict[str, CourierAccount | None] = {}
    for courier in ("pathao", "carrybee"):
        account_id = getattr(row, f"{courier}_courier_account_id", None) if row else None
        if account_id is not None:
            accounts[f"{courier}_account"] = await session.get(CourierAccount, account_id)
    out = redact(row, **accounts)
    if ctx.is_super_admin:
        out.can_choose_accounts = True
        options = await session.scalars(
            select(CourierAccount).order_by(CourierAccount.courier, func.lower(CourierAccount.name))
        )
        out.account_options = [brief(a) for a in options]
    return out


async def _pick_account(
    session: AsyncSession,
    row: StoreSettings,
    payload: StoreSettingsUpdate,
    courier: str,
    ctx: tenancy.StoreContext,
) -> None:
    field = f"{courier}_courier_account_id"
    if field not in payload.model_fields_set:
        return
    wanted = getattr(payload, field)
    if wanted == getattr(row, field):
        return
    if not ctx.is_super_admin:
        raise HTTPException(status_code=403, detail="Only a super admin can choose courier accounts")
    if wanted is not None:
        account = await session.get(CourierAccount, wanted)
        if account is None or account.courier != courier:
            raise HTTPException(status_code=400, detail=f"Not a {courier} account")
    setattr(row, field, wanted)


@router.get("/{store_id}/settings", response_model=StoreSettingsOut)
async def get_settings(
    store_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreSettingsOut:
    return await settings_out(session, await session.get(StoreSettings, ctx.store.id), ctx)


@router.put("/{store_id}/settings", response_model=StoreSettingsOut)
async def put_settings(
    store_id: int,
    payload: StoreSettingsUpdate,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreSettingsOut:
    wants_secret = any(v for v in (payload.meta_capi_token, payload.bdcourier_api_key))
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
    await _pick_account(session, row, payload, "pathao", ctx)
    row.pathao_store_id = payload.pathao_store_id
    row.pathao_item_type = payload.pathao_item_type
    row.pathao_parcel_weight_kg = payload.pathao_parcel_weight_kg
    if payload.pathao_enabled is not None:
        row.pathao_enabled = payload.pathao_enabled
    await _pick_account(session, row, payload, "carrybee", ctx)
    if payload.carrybee_enabled is not None:
        row.carrybee_enabled = payload.carrybee_enabled
    row.carrybee_store_id = payload.carrybee_store_id.strip()
    row.carrybee_product_type = payload.carrybee_product_type
    row.carrybee_item_weight_g = payload.carrybee_item_weight_g
    row.bdcourier_api_key_enc = apply_secret(row.bdcourier_api_key_enc, payload.bdcourier_api_key)
    await session.commit()
    await session.refresh(row)
    # Services read a cached, decrypted copy; drop it so the change is live.
    stores.invalidate()
    return await settings_out(session, row, ctx)


@router.post("/{store_id}/settings/pathao-test", response_model=PathaoStatusOut)
async def test_pathao(
    store_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> PathaoStatusOut:
    """
    Log in to the store's Pathao account and list the merchant stores it
    can see, so the Pathao store id can be copied rather than guessed.
    Unsaved edits are not tested: save first. A stale cached copy is dropped
    so the test reflects what was just saved.
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
    if cfg.account_id is None:
        out.error = "Choose a Pathao account first (a super admin does this)"
        return out
    missing = [
        name
        for name, value in (
            ("client id", cfg.client_id),
            ("client secret", cfg.client_secret),
            ("client email", cfg.username),
            ("password", cfg.password),
        )
        if not value
    ]
    if missing:
        out.error = "The Pathao account is missing: " + ", ".join(missing)
        return out
    # The pickup store may be what this test is for, so ask with a
    # stand-in for it.
    probe = cfg if cfg.store_id else stores.PathaoConfig(**{**cfg.__dict__, "store_id": 1})
    try:
        # force=True: a test must prove the credentials work now, not that a
        # token from last week is still cached.
        await pathao.get_access_token(probe, ctx.store.id, force=True)
        out.stores = await pathao.list_stores(probe, ctx.store.id)
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
    Call the store's Carrybee account and list the pickup stores it can see,
    so the store id can be picked rather than guessed. Unsaved edits are not
    tested: save first.
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
    if cfg.account_id is None:
        out.error = "Choose a Carrybee account first (a super admin does this)"
        return out
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
        out.error = "The Carrybee account is missing: " + ", ".join(missing)
        return out
    try:
        # list_stores refuses an unconfigured config; the pickup store may be
        # what this test is for, so ask with a stand-in for it.
        probe = cfg if cfg.store_id else stores.CarrybeeConfig(**{**cfg.__dict__, "store_id": "-"})
        out.stores = await carrybee.list_stores(probe)
    except carrybee.CarrybeeError as exc:
        out.error = carrybee.error_text(exc)
    return out
