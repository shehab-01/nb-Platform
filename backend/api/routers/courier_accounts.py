"""Courier accounts: the Pathao and Carrybee merchant accounts stores book
through (Settings → Courier). Super admins only — an account's credentials
book parcels for every store that picks it, which is a platform decision,
not a store's.

One account per merchant account at the courier, however many of our stores
use it: the courier calls one webhook URL per merchant account, so the URL,
secret and integration header live here, once. Stores pick an account in
their own settings and keep their own pickup store and parcel details.

Secrets go in and never come out, as on the store settings: the response
says whether each is set and its last characters; in an update a secret
left out (None) is kept, "" clears it, anything else replaces it.
"""
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import crypto, stores
from api.auth import require_super_admin
from api.db import get_session
from api.models import CourierAccount, Store, StoreSettings
from api.services import carrybee, pathao
from api.services.courier import CARRYBEE, PATHAO

router = APIRouter(
    prefix="/courier-accounts",
    tags=["Courier accounts"],
    dependencies=[Depends(require_super_admin)],
)

WEBHOOK_PATHS = {PATHAO: "/api/webhooks/pathao/", CARRYBEE: "/api/webhooks/carrybee/"}
Courier = Literal["pathao", "carrybee"]


class AccountStore(BaseModel):
    store_id: int
    name: str


class CourierAccountBrief(BaseModel):
    """What a store's settings show of the account it uses."""

    id: int
    courier: Courier
    name: str
    client_id: str
    # Pathao's merchant login email; empty for Carrybee.
    username: str
    # Relative to the admin's own origin.
    webhook_path: str
    webhook_secret_set: bool
    integration_header_set: bool


class CourierAccountOut(CourierAccountBrief):
    client_secret_set: bool
    client_secret_hint: str | None
    password_set: bool
    client_context_set: bool
    client_context_hint: str | None
    webhook_secret_hint: str | None
    integration_header: str
    sandbox: bool
    # The stores booking through it; an account in use cannot be deleted.
    used_by: list[AccountStore]


class CourierAccountIn(BaseModel):
    courier: Courier
    name: str = Field(min_length=1, max_length=120)
    client_id: str = Field(default="", max_length=120)
    client_secret: str | None = Field(default=None, max_length=500)
    username: str = Field(default="", max_length=255)
    password: str | None = Field(default=None, max_length=500)
    client_context: str | None = Field(default=None, max_length=500)
    webhook_secret: str | None = Field(default=None, max_length=500)
    integration_header: str = Field(default="", max_length=100)


class CourierAccountTestOut(BaseModel):
    sandbox: bool
    # The courier's pickup stores the account can book from.
    stores: list[dict] = []
    error: str | None = None


def _peek(blob: bytes | None) -> tuple[bool, str | None]:
    if blob is None:
        return False, None
    if not crypto.available():
        return True, None
    try:
        return True, crypto.hint(crypto.decrypt(blob))
    except crypto.InvalidToken:
        # Encrypted under a key that is no longer configured.
        return True, "?"


def brief(account: CourierAccount) -> CourierAccountBrief:
    return CourierAccountBrief(
        id=account.id,
        courier=account.courier,  # type: ignore[arg-type]
        name=account.name,
        client_id=account.client_id,
        username=account.username,
        webhook_path=WEBHOOK_PATHS[account.courier] + account.webhook_token,
        webhook_secret_set=account.webhook_secret_enc is not None,
        integration_header_set=bool(account.integration_header),
    )


def redact(account: CourierAccount, used_by: list[AccountStore]) -> CourierAccountOut:
    """What a super admin may see. Decrypts only to compute the hints."""
    secret = _peek(account.client_secret_enc)
    context = _peek(account.client_context_enc)
    hook = _peek(account.webhook_secret_enc)
    return CourierAccountOut(
        **brief(account).model_dump(),
        client_secret_set=secret[0],
        client_secret_hint=secret[1],
        password_set=account.password_enc is not None,
        client_context_set=context[0],
        client_context_hint=context[1],
        webhook_secret_hint=hook[1],
        integration_header=account.integration_header,
        sandbox=pathao.is_sandbox() if account.courier == PATHAO else carrybee.is_sandbox(),
        used_by=used_by,
    )


def _secret(current: bytes | None, incoming: str | None) -> bytes | None:
    """None keeps, "" clears, text replaces (encrypted). Surrounding
    whitespace is dropped: a trailing newline from a paste is not part of
    any token or password, and Pathao answers it with a bare 400."""
    if incoming is None:
        return current
    incoming = incoming.strip()
    if incoming == "":
        return None
    if not crypto.available():
        raise HTTPException(
            status_code=503,
            detail="APP_ENCRYPTION_KEY is not configured on the server; secrets cannot be saved",
        )
    return crypto.encrypt(incoming)


async def users_of(session: AsyncSession, account_ids: list[int]) -> dict[int, list[AccountStore]]:
    """The stores using each account, by account id."""
    out: dict[int, list[AccountStore]] = {i: [] for i in account_ids}
    if not account_ids:
        return out
    rows = await session.execute(
        select(
            StoreSettings.pathao_courier_account_id,
            StoreSettings.carrybee_courier_account_id,
            Store.id,
            Store.name,
        )
        .join(Store, Store.id == StoreSettings.store_id)
        .where(
            or_(
                StoreSettings.pathao_courier_account_id.in_(account_ids),
                StoreSettings.carrybee_courier_account_id.in_(account_ids),
            )
        )
        .order_by(Store.name)
    )
    for pathao_id, carrybee_id, store_id, name in rows:
        for account_id in {pathao_id, carrybee_id}:
            if account_id in out:
                out[account_id].append(AccountStore(store_id=store_id, name=name))
    return out


def _apply(account: CourierAccount, payload: CourierAccountIn) -> None:
    client_id = payload.client_id.strip()
    username = payload.username.strip().lower() if account.courier == PATHAO else ""
    if (client_id, username) != (account.client_id, account.username):
        # Another login: a cached Pathao token belongs to the old one.
        account.access_token = account.refresh_token = account.token_expires_at = None
    account.name = payload.name.strip()
    account.client_id = client_id
    account.client_secret_enc = _secret(account.client_secret_enc, payload.client_secret)
    account.webhook_secret_enc = _secret(account.webhook_secret_enc, payload.webhook_secret)
    account.integration_header = payload.integration_header.strip()
    if account.courier == PATHAO:
        account.username = username
        account.password_enc = _secret(account.password_enc, payload.password)
    else:
        account.client_context_enc = _secret(account.client_context_enc, payload.client_context)


async def _get(session: AsyncSession, account_id: int) -> CourierAccount:
    account = await session.get(CourierAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Unknown courier account")
    return account


async def _out(session: AsyncSession, account: CourierAccount) -> CourierAccountOut:
    return redact(account, (await users_of(session, [account.id]))[account.id])


@router.get("", response_model=list[CourierAccountOut])
async def list_accounts(session: AsyncSession = Depends(get_session)) -> list[CourierAccountOut]:
    accounts = (
        await session.scalars(
            select(CourierAccount).order_by(CourierAccount.courier, func.lower(CourierAccount.name))
        )
    ).all()
    users = await users_of(session, [a.id for a in accounts])
    return [redact(a, users[a.id]) for a in accounts]


@router.post("", response_model=CourierAccountOut, status_code=201)
async def create_account(
    payload: CourierAccountIn, session: AsyncSession = Depends(get_session)
) -> CourierAccountOut:
    # The URL exists from the start and never changes: it is pasted into the
    # courier's panel once.
    account = CourierAccount(courier=payload.courier, webhook_token=secrets.token_urlsafe(24))
    _apply(account, payload)
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return await _out(session, account)


@router.put("/{account_id}", response_model=CourierAccountOut)
async def update_account(
    account_id: int, payload: CourierAccountIn, session: AsyncSession = Depends(get_session)
) -> CourierAccountOut:
    account = await _get(session, account_id)
    if payload.courier != account.courier:
        raise HTTPException(status_code=400, detail="An account's courier cannot change")
    _apply(account, payload)
    await session.commit()
    await session.refresh(account)
    # Stores read a cached, decrypted copy; drop it so the change is live.
    stores.invalidate()
    return await _out(session, account)


@router.delete("/{account_id}", status_code=204)
async def delete_account(account_id: int, session: AsyncSession = Depends(get_session)) -> None:
    account = await _get(session, account_id)
    used_by = (await users_of(session, [account.id]))[account.id]
    if used_by:
        raise HTTPException(
            status_code=409,
            detail="Used by " + ", ".join(s.name for s in used_by) + "; pick another account there first",
        )
    await session.delete(account)
    await session.commit()


@router.post("/{account_id}/test", response_model=CourierAccountTestOut)
async def test_account(
    account_id: int, session: AsyncSession = Depends(get_session)
) -> CourierAccountTestOut:
    """Call the courier with the account's *saved* credentials and list the
    pickup stores it can book from. Unsaved edits are not tested: save
    first."""
    account = await _get(session, account_id)
    if account.courier == PATHAO:
        cfg = stores.pathao_config(account, None)
        out = CourierAccountTestOut(sandbox=pathao.is_sandbox())
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
            out.error = "Missing: " + ", ".join(missing)
            return out
        try:
            # force=True: a test must prove the credentials work now, not
            # that a token from last week is still cached.
            await pathao.get_access_token(cfg, 0, force=True)
            out.stores = await pathao.list_stores(cfg, 0)
        except pathao.PathaoError as exc:
            out.error = pathao.error_text(exc)
        return out

    cfg = stores.carrybee_config(account, None)
    out = CourierAccountTestOut(sandbox=carrybee.is_sandbox())
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
        out.stores = await carrybee.list_stores(cfg)
    except carrybee.CarrybeeError as exc:
        out.error = carrybee.error_text(exc)
    return out
