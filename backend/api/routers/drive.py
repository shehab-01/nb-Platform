"""Connecting the platform's Google Drive (Platform → System).

A super admin presses Connect: the API hands back Google's consent page with
a signed, short-lived `state` naming them and the admin page to come back to.
Google sends the browser to /drive/oauth/callback with a code; the callback
checks the state (it cannot rely on the session cookie — in development the
redirect lands on localhost, not the admin's hostname), trades the code for a
refresh token, stores it encrypted and returns the browser to the admin.

Responses only ever say whether Drive is connected and to which account.
"""
import logging
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api import crypto
from api.auth import require_super_admin
from api.config import settings
from api.db import get_session
from api.models import DriveConnection, User, UserRole, UserStatus
from api.services import gdrive

log = logging.getLogger(__name__)

router = APIRouter(prefix="/drive", tags=["Google Drive"])

# Long enough to sign in to Google and approve; short enough to be useless later.
STATE_MAX_AGE = 15 * 60


class DriveStatusOut(BaseModel):
    # The OAuth client is set in the environment.
    configured: bool
    connected: bool
    account_email: str | None = None
    root_folder: str
    connected_at: str | None = None


class ConnectOut(BaseModel):
    url: str


def _signer() -> URLSafeTimedSerializer:
    if not settings.session_secret:
        raise HTTPException(status_code=500, detail="SESSION_SECRET is not set")
    return URLSafeTimedSerializer(settings.session_secret, salt="drive-oauth")


@router.get("/status", response_model=DriveStatusOut)
async def status(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_super_admin),
) -> DriveStatusOut:
    conn = await gdrive.connection(session)
    return DriveStatusOut(
        configured=gdrive.configured(),
        connected=conn is not None,
        account_email=conn.account_email if conn else None,
        root_folder=settings.google_drive_root_name,
        connected_at=conn.connected_at.isoformat() if conn else None,
    )


@router.post("/connect", response_model=ConnectOut)
async def connect(
    request: Request, user: User = Depends(require_super_admin)
) -> ConnectOut:
    """Google's consent page for this super admin. The browser's own origin
    (the admin it is on) is signed into the state so the callback can send
    it back there."""
    if not gdrive.configured():
        raise HTTPException(
            status_code=409,
            detail="Google Drive is not configured: set GOOGLE_DRIVE_CLIENT_ID, "
            "GOOGLE_DRIVE_CLIENT_SECRET and GOOGLE_DRIVE_REDIRECT_URI",
        )
    if not crypto.available():
        raise HTTPException(status_code=409, detail="APP_ENCRYPTION_KEY is not set")
    origin = request.headers.get("origin", "")
    parts = urlsplit(origin)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise HTTPException(status_code=400, detail="Connect from the admin page")
    state = _signer().dumps({"uid": user.id, "back": f"{parts.scheme}://{parts.netloc}"})
    return ConnectOut(url=gdrive.authorization_url(state))


@router.get("/oauth/callback", include_in_schema=False)
async def callback(
    state: str = Query(...),
    code: str | None = Query(None),
    error: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    """Where Google returns the browser. Always ends in a redirect to the
    admin's System page with ?drive=connected or ?drive_error=…"""
    try:
        claims = _signer().loads(state, max_age=STATE_MAX_AGE)
    except SignatureExpired:
        raise HTTPException(status_code=400, detail="That link expired; press Connect again")
    except BadSignature:
        raise HTTPException(status_code=400, detail="Invalid state")
    back = f"{claims['back']}/admin/system"

    def done(**params: str) -> RedirectResponse:
        return RedirectResponse(f"{back}?{urlencode(params)}", status_code=303)

    if error:
        # e.g. access_denied when the admin pressed Cancel at Google.
        return done(drive_error=f"Google said: {error}")
    if not code:
        return done(drive_error="Google sent no code")

    # The state proves who started this; make sure they still may.
    user = await session.get(User, claims["uid"])
    if user is None or user.role != UserRole.super_admin or user.status != UserStatus.active:
        return done(drive_error="Only an active super admin can connect Google Drive")

    try:
        refresh = await gdrive.exchange_code(code)
    except gdrive.DriveError as err:
        return done(drive_error=err.message)

    # Reconnecting replaces the stored token. The old one is not revoked:
    # for the same account, revoking it can revoke the whole grant, the new
    # token included. It simply stops being used.
    conn = await gdrive.connection(session)
    if conn is None:
        conn = DriveConnection(id=gdrive.CONNECTION_ID)
        session.add(conn)
    conn.refresh_token_enc = crypto.encrypt(refresh)
    conn.connected_by_id = user.id
    conn.account_email = None
    conn.root_folder_id = None
    await session.commit()
    # A different account (or a fresh grant) may not see the old folders.
    await gdrive.forget_folders(session)

    try:
        conn.account_email = await gdrive.account_email(session)
        await gdrive.root_folder(session)
        await session.commit()
    except gdrive.DriveError as err:
        log.warning("Drive: connected, but the first call failed: %s", err.message)
        return done(drive_error=f"Connected, but Drive answered: {err.message}")
    return done(drive="connected")


@router.post("/disconnect", status_code=204)
async def disconnect(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_super_admin),
) -> None:
    """Forget the account and revoke its grant at Google. Files already in
    Drive stay there; new proofs cannot be added until it is connected again."""
    conn = await gdrive.connection(session)
    if conn is None:
        return
    refresh = crypto.decrypt(conn.refresh_token_enc)
    await gdrive.forget_folders(session)
    await session.delete(conn)
    await session.commit()
    if refresh:
        await gdrive.revoke(refresh)
