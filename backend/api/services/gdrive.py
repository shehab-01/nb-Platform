"""Google Drive: the one account the platform keeps its files in.

OAuth "Web application" client, scope drive.file — the app sees only files and
folders it created, nothing else in the account. A super admin connects the
account once (api.routers.drive); its refresh token is stored encrypted in
drive_connection and exchanged here for short-lived access tokens, cached in
memory per process. Nothing in this module logs or returns a token.

Calls go straight to Drive's REST API with httpx (async, like the rest of the
API) rather than through Google's synchronous client library.

Folders: nbPlatform / <store> / Expenses / <yyyy-mm-dd>. Each is found or
made once and its id remembered in drive_folders (by store id, so a store
rename keeps its folder). If someone deletes a folder in Drive, the next
upload notices (404), forgets the stale ids and makes them again.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import crypto
from api.config import settings
from api.models import DriveConnection, DriveFolder, Store

log = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/drive.file"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id"
FOLDER = "application/vnd.google-apps.folder"
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
CONNECTION_ID = 1


class DriveError(Exception):
    """A Drive call that failed. `message` is safe to show an admin."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.message = message
        self.status = status


class DriveNotConnected(DriveError):
    """No account connected, or Google no longer accepts its token."""


async def _send(method: str, url: str, **kwargs) -> httpx.Response:
    """One HTTP call to Google. A network failure becomes a DriveError with a
    plain message, so callers handle one kind of failure."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            return await client.request(method, url, **kwargs)
    except httpx.HTTPError as err:
        raise DriveError(f"Could not reach Google ({type(err).__name__})") from err


def configured() -> bool:
    """The OAuth client is set in the environment; connecting is possible."""
    return bool(
        settings.google_drive_client_id
        and settings.google_drive_client_secret
        and settings.google_drive_redirect_uri
    )


# --- OAuth ------------------------------------------------------------------------


def authorization_url(state: str) -> str:
    """Where to send the super admin to grant access. prompt=consent with
    access_type=offline makes Google return a refresh token every time, so
    reconnecting always yields a fresh one."""
    return f"{AUTH_URL}?" + urlencode(
        {
            "client_id": settings.google_drive_client_id,
            "redirect_uri": settings.google_drive_redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )


async def exchange_code(code: str) -> str:
    """The refresh token for an authorization code."""
    r = await _send(
        "POST",
        TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.google_drive_client_id,
            "client_secret": settings.google_drive_client_secret,
            "redirect_uri": settings.google_drive_redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    if r.status_code != 200:
        raise DriveError(f"Google refused the sign-in ({_oauth_error(r)})", r.status_code)
    refresh = r.json().get("refresh_token")
    if not refresh:
        raise DriveError(
            "Google did not hand over a refresh token. Remove the app at "
            "myaccount.google.com/permissions and connect again."
        )
    _cache.clear()
    return refresh


async def revoke(refresh_token: str) -> None:
    """Tell Google to forget the grant. Best effort: disconnecting must work
    even if Google is unreachable."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            await client.post(REVOKE_URL, data={"token": refresh_token})
    except httpx.HTTPError:
        log.warning("Drive: could not reach Google to revoke the grant")
    _cache.clear()


def _oauth_error(r: httpx.Response) -> str:
    try:
        return str(r.json().get("error", r.status_code))
    except ValueError:
        return str(r.status_code)


# --- Access tokens --------------------------------------------------------------


@dataclass
class _Token:
    value: str
    expires_at: float


# Keyed by the connection's ciphertext, so reconnecting retires the old token.
_cache: dict[bytes, _Token] = {}


async def connection(session: AsyncSession) -> DriveConnection | None:
    return await session.get(DriveConnection, CONNECTION_ID)


async def _access_token(session: AsyncSession, *, fresh: bool = False) -> str:
    conn = await connection(session)
    if conn is None:
        raise DriveNotConnected("Google Drive is not connected (Platform → System)")
    cached = _cache.get(conn.refresh_token_enc)
    if cached and not fresh and cached.expires_at > time.time() + 60:
        return cached.value
    refresh = crypto.decrypt(conn.refresh_token_enc)
    r = await _send(
        "POST",
        TOKEN_URL,
        data={
            "refresh_token": refresh,
            "client_id": settings.google_drive_client_id,
            "client_secret": settings.google_drive_client_secret,
            "grant_type": "refresh_token",
        },
    )
    if r.status_code != 200:
        if _oauth_error(r) == "invalid_grant":
            raise DriveNotConnected(
                "Google no longer accepts the Drive connection (revoked, or the app is "
                "still in Testing). Reconnect it from Platform → System."
            )
        raise DriveError(f"Could not reach Google Drive ({_oauth_error(r)})", r.status_code)
    body = r.json()
    _cache.clear()
    _cache[conn.refresh_token_enc] = _Token(
        body["access_token"], time.time() + int(body.get("expires_in", 3600))
    )
    return body["access_token"]


async def _call(session: AsyncSession, method: str, url: str, **kwargs) -> httpx.Response:
    """One Drive request, retried once with a fresh token on 401."""
    extra = kwargs.pop("headers", {})
    for attempt in (0, 1):
        token = await _access_token(session, fresh=attempt == 1)
        headers = {**extra, "Authorization": f"Bearer {token}"}
        r = await _send(method, url, headers=headers, **kwargs)
        if r.status_code != 401:
            break
    if r.status_code >= 400:
        raise DriveError(_drive_error(r), r.status_code)
    return r


def _drive_error(r: httpx.Response) -> str:
    try:
        message = r.json()["error"]["message"]
    except (ValueError, KeyError, TypeError):
        message = f"HTTP {r.status_code}"
    return f"Google Drive: {message}"


# --- Files and folders ------------------------------------------------------------


def _quote(name: str) -> str:
    """A name inside a Drive query string."""
    return name.replace("\\", "\\\\").replace("'", "\\'")


async def account_email(session: AsyncSession) -> str | None:
    r = await _call(session, "GET", f"{API}/about", params={"fields": "user(emailAddress)"})
    return r.json().get("user", {}).get("emailAddress")


async def find_folder(session: AsyncSession, name: str, parent: str) -> str | None:
    q = (
        f"name = '{_quote(name)}' and '{_quote(parent)}' in parents "
        f"and mimeType = '{FOLDER}' and trashed = false"
    )
    r = await _call(
        session, "GET", f"{API}/files", params={"q": q, "fields": "files(id)", "pageSize": 1}
    )
    files = r.json().get("files", [])
    return files[0]["id"] if files else None


async def create_folder(session: AsyncSession, name: str, parent: str) -> str:
    r = await _call(
        session,
        "POST",
        f"{API}/files",
        params={"fields": "id"},
        json={"name": name, "mimeType": FOLDER, "parents": [parent]},
    )
    return r.json()["id"]


async def get_or_create_folder(session: AsyncSession, name: str, parent: str) -> str:
    return await find_folder(session, name, parent) or await create_folder(
        session, name, parent
    )


async def rename(session: AsyncSession, file_id: str, name: str) -> None:
    await _call(session, "PATCH", f"{API}/files/{file_id}", json={"name": name})


async def upload(
    session: AsyncSession, folder_id: str, name: str, mime_type: str, data: bytes
) -> str:
    """Upload one file into a folder; its Drive id. Private: no sharing."""
    boundary = uuid.uuid4().hex
    meta = json.dumps({"name": name, "parents": [folder_id]}).encode()
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
        + meta
        + f"\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n".encode()
        + data
        + f"\r\n--{boundary}--\r\n".encode()
    )
    r = await _call(
        session,
        "POST",
        UPLOAD,
        content=body,
        headers={"Content-Type": f"multipart/related; boundary={boundary}"},
    )
    return r.json()["id"]


async def download(session: AsyncSession, file_id: str) -> bytes:
    r = await _call(session, "GET", f"{API}/files/{file_id}", params={"alt": "media"})
    return r.content


async def trash(session: AsyncSession, file_id: str) -> None:
    """Move a file to Drive's bin (recoverable there for 30 days) rather than
    deleting it outright. Already gone counts as done."""
    try:
        await _call(session, "PATCH", f"{API}/files/{file_id}", json={"trashed": True})
    except DriveError as err:
        if err.status != 404:
            raise


# --- The platform's folders ----------------------------------------------------------


async def root_folder(session: AsyncSession) -> str:
    """The app's top folder, made on first use and remembered."""
    conn = await connection(session)
    if conn is None:
        raise DriveNotConnected("Google Drive is not connected (Platform → System)")
    if conn.root_folder_id is None:
        conn.root_folder_id = await get_or_create_folder(
            session, settings.google_drive_root_name, "root"
        )
        await session.commit()
    return conn.root_folder_id


def store_folder_name(store: Store) -> str:
    return f"{store.name} — {store.subtitle}" if store.subtitle else store.name


async def _folder(session: AsyncSession, store: Store, path: str) -> str:
    """The Drive folder for a path under a store ("" is the store's own
    folder), making whatever is missing on the way down."""
    cached = await session.scalar(
        select(DriveFolder.folder_id).where(
            DriveFolder.store_id == store.id, DriveFolder.path == path
        )
    )
    if cached:
        return cached
    if path == "":
        parent, name = await root_folder(session), store_folder_name(store)
    else:
        head, _, name = path.rpartition("/")
        parent = await _folder(session, store, head)
    folder_id = await get_or_create_folder(session, name, parent)
    session.add(DriveFolder(store_id=store.id, path=path, folder_id=folder_id))
    await session.commit()
    return folder_id


async def forget_folders(session: AsyncSession, store_id: int | None = None) -> None:
    """Drop remembered folder ids (one store's, or all and the root's) so the
    next use looks them up again — after a folder was deleted in Drive, or
    the account changed."""
    query = delete(DriveFolder)
    if store_id is not None:
        query = query.where(DriveFolder.store_id == store_id)
    await session.execute(query)
    if store_id is None and (conn := await connection(session)) is not None:
        conn.root_folder_id = None
    await session.commit()


async def store_folder(session: AsyncSession, store: Store) -> str:
    return await _folder(session, store, "")


async def in_folder(session: AsyncSession, store: Store, path: str, act):
    """Run `act(folder_id)` against a store's folder at `path`. If a
    remembered folder was deleted in Drive meanwhile (404), forget the
    store's folders and the root, rebuild the path and try once more."""
    try:
        return await act(await _folder(session, store, path))
    except DriveError as err:
        if err.status != 404:
            raise
        log.info("Drive: a remembered folder is gone for store %s; rebuilding", store.id)
        await forget_folders(session, store.id)
        conn = await connection(session)
        if conn is not None:
            conn.root_folder_id = None
            await session.commit()
        return await act(await _folder(session, store, path))


def day_path(day: str) -> str:
    return f"Expenses/{day}"


# Pictures sent from a phone wait here until their expense is saved.
INCOMING = "Expenses/Incoming"


async def upload_to_day(
    session: AsyncSession, store: Store, day: str, name: str, mime_type: str, data: bytes
) -> str:
    """Upload into a store's Expenses folder for a day ("yyyy-mm-dd")."""
    return await in_folder(
        session, store, day_path(day), lambda f: upload(session, f, name, mime_type, data)
    )


async def thumbnail(session: AsyncSession, file_id: str, size: int = 320) -> bytes | None:
    """Drive's own small preview of a file (photos and PDFs alike), longest
    side `size` px; None when Drive has not made one (yet). The preview link
    is fetched with the account's token here, never handed to a browser."""
    r = await _call(session, "GET", f"{API}/files/{file_id}", params={"fields": "thumbnailLink"})
    link = r.json().get("thumbnailLink")
    if not link:
        return None
    link = re.sub(r"=s\d+$", f"=s{size}", link)
    token = await _access_token(session)
    r = await _send("GET", link, headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        return None
    return r.content


async def move(session: AsyncSession, file_id: str, to_folder: str) -> None:
    """Put a file in another folder (and only there)."""
    r = await _call(session, "GET", f"{API}/files/{file_id}", params={"fields": "parents"})
    parents = ",".join(r.json().get("parents", []))
    await _call(
        session,
        "PATCH",
        f"{API}/files/{file_id}",
        params={"addParents": to_folder, "removeParents": parents, "fields": "id"},
    )
