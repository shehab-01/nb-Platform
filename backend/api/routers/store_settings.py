"""Per-store integration settings: Meta Pixel / Conversions API, Pathao,
FraudBD. Edited from the store's own Settings page by anyone with the
"settings" permission there (owners, and super admins everywhere). The store
in the path must be the one named by X-Admin-Store: the header is what the
membership check is made against, so the two can never disagree.

Secrets go in and never come out: the response says whether each is set and
its last characters. In the update, a secret field left out (None) keeps the
stored value, "" clears it, anything else replaces it.
"""
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api import crypto, stores, tenancy
from api.auth import get_current_user
from api.config import settings as app_settings
from api.db import get_session
from api.models import StoreSettings, User, UserRole
from api.schemas import PathaoStatusOut
from api.services import pathao

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
    pathao_parcel_weight_kg: Decimal
    fraudbd_api_key_set: bool
    fraudbd_api_key_hint: str | None
    encryption_available: bool


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
    pathao_parcel_weight_kg: Decimal = Field(default=Decimal("1"), ge=Decimal("0.5"), le=Decimal("10"))
    fraudbd_api_key: str | None = Field(default=None, max_length=500)


def redact(row: StoreSettings | None) -> StoreSettingsOut:
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
            pathao_client_id="", pathao_client_secret_set=False, pathao_client_secret_hint=None,
            pathao_email="", pathao_password_set=False, pathao_store_id=None,
            pathao_item_type="parcel", pathao_parcel_weight_kg=Decimal("1"),
            fraudbd_api_key_set=False, fraudbd_api_key_hint=None,
            encryption_available=ok,
        )
    capi = peek(row.meta_capi_token_enc)
    secret = peek(row.pathao_client_secret_enc)
    fraud = peek(row.fraudbd_api_key_enc)
    return StoreSettingsOut(
        meta_pixel_id=row.meta_pixel_id,
        meta_test_event_code=row.meta_test_event_code,
        meta_capi_token_set=capi[0],
        meta_capi_token_hint=capi[1],
        pathao_client_id=row.pathao_client_id,
        pathao_client_secret_set=secret[0],
        pathao_client_secret_hint=secret[1],
        pathao_email=row.pathao_email,
        pathao_password_set=row.pathao_password_enc is not None,
        pathao_store_id=row.pathao_store_id,
        pathao_item_type=row.pathao_item_type,
        pathao_parcel_weight_kg=row.pathao_parcel_weight_kg,
        fraudbd_api_key_set=fraud[0],
        fraudbd_api_key_hint=fraud[1],
        encryption_available=ok,
    )


def apply_secret(current: bytes | None, incoming: str | None) -> bytes | None:
    """None keeps, "" clears, text replaces (encrypted)."""
    if incoming is None:
        return current
    if incoming == "":
        return None
    return crypto.encrypt(incoming)


@router.get("/{store_id}/settings", response_model=StoreSettingsOut)
async def get_settings(
    store_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreSettingsOut:
    return redact(await session.get(StoreSettings, ctx.store.id))


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
            payload.pathao_password, payload.fraudbd_api_key,
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
    row.pathao_client_id = payload.pathao_client_id.strip()
    row.pathao_client_secret_enc = apply_secret(row.pathao_client_secret_enc, payload.pathao_client_secret)
    row.pathao_email = payload.pathao_email.strip().lower()
    row.pathao_password_enc = apply_secret(row.pathao_password_enc, payload.pathao_password)
    row.pathao_store_id = payload.pathao_store_id
    row.pathao_item_type = payload.pathao_item_type
    row.pathao_parcel_weight_kg = payload.pathao_parcel_weight_kg
    row.fraudbd_api_key_enc = apply_secret(row.fraudbd_api_key_enc, payload.fraudbd_api_key)
    await session.commit()
    await session.refresh(row)
    # Services read a cached, decrypted copy; drop it so the change is live.
    stores.invalidate()
    return redact(row)


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
        enabled=cfg.enabled,
        sandbox=pathao.is_sandbox(),
        base_url=app_settings.pathao_base_url,
        store_id=cfg.store_id,
        unit_weight_kg=cfg.unit_weight_kg,
    )
    if not cfg.enabled:
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
