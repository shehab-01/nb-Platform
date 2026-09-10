from fastapi import APIRouter, Depends, HTTPException, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.auth import (
    clear_session_cookie,
    get_session_user,
    set_session_cookie,
)
from api.config import settings
from api.db import get_session
from api.models import Store, StoreRole, StoreUser, User, UserRole, UserStatus
from api.ratelimit import logins_limiter
from api.schemas import UserOut

router = APIRouter(prefix="/auth", tags=["Auth"])

_google_request = google_requests.Request()


class GoogleLogin(BaseModel):
    credential: str


def _verify_google_token(credential: str) -> dict:
    # google-auth uses blocking HTTP for Google's certs (cached after the
    # first call) — keep it off the event loop.
    return id_token.verify_oauth2_token(
        credential, _google_request, settings.google_client_id
    )


@router.post(
    "/google", response_model=UserOut, dependencies=[Depends(logins_limiter)]
)
async def login_with_google(
    payload: GoogleLogin,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> User:
    if not settings.google_client_id:
        raise HTTPException(status_code=500, detail="Google auth not configured")
    try:
        claims = await run_in_threadpool(_verify_google_token, payload.credential)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    email = claims.get("email", "").lower()
    if not email or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Email not verified")

    user = await session.scalar(select(User).where(User.email == email))
    if user is None:
        is_super = email in settings.super_admin_emails
        user = User(
            email=email,
            name=claims.get("name") or email.split("@")[0],
            picture_url=claims.get("picture"),
            role=UserRole.super_admin if is_super else UserRole.staff,
            status=UserStatus.active if is_super else UserStatus.pending,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
    else:
        # Keep profile fresh; also promote if added to SUPER_ADMIN_EMAILS later.
        user.name = claims.get("name") or user.name
        user.picture_url = claims.get("picture") or user.picture_url
        if email in settings.super_admin_emails:
            user.role = UserRole.super_admin
            user.status = UserStatus.active
        await session.commit()

    set_session_cookie(response, user.id)
    return user


class AuthProviders(BaseModel):
    """Which sign-in methods this deployment offers; the login page renders
    a button per enabled one."""

    google: bool
    # The OAuth client id is public by design (it is in every login page), so
    # serving it here is what lets it be a runtime setting rather than a value
    # baked into the web image. Empty when Google sign-in is off.
    google_client_id: str
    dev: bool


@router.get("/providers", response_model=AuthProviders)
async def providers() -> AuthProviders:
    return AuthProviders(
        google=bool(settings.google_client_id),
        google_client_id=settings.google_client_id,
        dev=bool(settings.dev_login_email),
    )


@router.post(
    "/dev-login", response_model=UserOut, dependencies=[Depends(logins_limiter)]
)
async def dev_login(
    response: Response, session: AsyncSession = Depends(get_session)
) -> User:
    """
    Development only: sign in as the account named by DEV_LOGIN_EMAIL without
    Google. 404 (not 403) when the variable is unset, so a production server
    does not even admit the route exists. The account is created as an active
    super admin if it does not exist yet, which is how a fresh dev database
    gets its first admin.
    """
    if not settings.dev_login_email:
        raise HTTPException(status_code=404, detail="Not found")
    email = settings.dev_login_email
    user = await session.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            name=email.split("@")[0],
            role=UserRole.super_admin,
            status=UserStatus.active,
        )
        session.add(user)
        await session.flush()
    # Approved, and an owner of every store, so the switcher can be exercised
    # locally even after the super_admin role is taken away in the Users page.
    member_of = set(
        (await session.scalars(select(StoreUser.store_id).where(StoreUser.user_id == user.id))).all()
    )
    for store_id in await session.scalars(select(Store.id).where(Store.is_active.is_(True))):
        if store_id not in member_of:
            session.add(StoreUser(store_id=store_id, user_id=user.id, role=StoreRole.owner.value))
    await session.commit()
    await session.refresh(user)
    set_session_cookie(response, user.id)
    return user


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_session_user)) -> User:
    return user


@router.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    clear_session_cookie(response)
