"""Sending an expense proof from a phone (a QR code in the expense drawer).

The drawer asks for a drop: a random secret, good for DROP_MINUTES, of which
only a SHA-256 hash is stored. It shows the secret as a QR code linking to
/drop/<secret>, a page outside the admin that needs no sign-in. The phone
posts pictures there; each goes straight to Google Drive (the store's
Expenses/Incoming folder) and is never written to this server's disk. The
drawer polls the drop and shows what arrived. Saving the expense attaches
the pictures (moved into the day's folder); discarding, or letting the drop
expire, bins them.

The secret only lets its holder add pictures to that one drop — it cannot
read anything. Admin-side endpoints are behind the store's CRM access like
the rest of the expenses.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import tenancy
from api.config import settings
from api.db import get_session
from api.models import ExpenseProof, ProofDrop, ProofDropFile, Store
from api.routers.expenses import (
    DHAKA,
    MAX_PROOFS,
    _drive_http,
    _get,
    _safe_name,
    _sniff,
    preview,
)
from api.schemas import ExpenseProofOut
from api.services import gdrive

log = logging.getLogger(__name__)

admin_router = APIRouter(prefix="/proof-drops", tags=["Expenses"])
public_router = APIRouter(prefix="/drop", tags=["Expenses"])

DROP_MINUTES = 15


class DropFileOut(BaseModel):
    id: int
    filename: str
    mime_type: str
    size: int


class DropOut(BaseModel):
    id: int
    expires_at: datetime
    files: list[DropFileOut]


class DropCreatedOut(DropOut):
    # The secret for the QR code. Returned once, here; only its hash is kept.
    token: str


class DropPublicOut(BaseModel):
    """What the phone page may know: whose drop it is and how much room is
    left. Nothing about the store's expenses."""

    store_name: str
    expires_at: datetime
    received: int
    max_files: int
    max_bytes: int


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _files(session: AsyncSession, drop: ProofDrop) -> list[ProofDropFile]:
    return list(
        await session.scalars(
            select(ProofDropFile)
            .where(ProofDropFile.store_id == drop.store_id, ProofDropFile.drop_id == drop.id)
            .order_by(ProofDropFile.created_at, ProofDropFile.id)
        )
    )


async def _out(session: AsyncSession, drop: ProofDrop) -> DropOut:
    return DropOut(
        id=drop.id,
        expires_at=drop.expires_at,
        files=[
            DropFileOut(id=f.id, filename=f.filename, mime_type=f.mime_type, size=f.size)
            for f in await _files(session, drop)
        ],
    )


async def _discard(session: AsyncSession, drop: ProofDrop) -> None:
    """Bin whatever arrived and forget the drop. A Drive hiccup leaves a file
    in Incoming rather than keeping the drop alive."""
    for f in await _files(session, drop):
        try:
            await gdrive.trash(session, f.drive_file_id)
        except gdrive.DriveError as err:
            log.warning("Drive: could not bin an unclaimed phone upload: %s", err.message)
    await session.delete(drop)
    await session.commit()


async def _sweep(session: AsyncSession, store_id: int) -> None:
    """Clear this store's expired drops. Run whenever drops are touched, so
    no scheduler is needed for what is a rare leftover."""
    expired = (
        await session.scalars(
            select(ProofDrop).where(
                ProofDrop.store_id == store_id, ProofDrop.expires_at < _now()
            )
        )
    ).all()
    for drop in expired:
        await _discard(session, drop)


async def _admin_drop(session: AsyncSession, store_id: int, drop_id: int) -> ProofDrop:
    drop = await session.get(ProofDrop, drop_id)
    if drop is None or drop.store_id != store_id:
        raise HTTPException(status_code=404, detail="No such phone upload")
    return drop


# --- The drawer's side (signed in, CRM access) ---------------------------------------


@admin_router.post("", response_model=DropCreatedOut, status_code=201)
async def create_drop(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.require_crm),
) -> DropCreatedOut:
    """A new phone-upload link for the drawer's QR code."""
    if await gdrive.connection(session) is None:
        raise HTTPException(
            status_code=409, detail="Google Drive is not connected (Platform → System)"
        )
    await _sweep(session, ctx.store.id)
    token = secrets.token_urlsafe(32)
    drop = ProofDrop(
        store_id=ctx.store.id,
        token_hash=_hash(token),
        created_by_id=ctx.user.id,
        expires_at=_now() + timedelta(minutes=DROP_MINUTES),
    )
    session.add(drop)
    await session.commit()
    return DropCreatedOut(id=drop.id, expires_at=drop.expires_at, files=[], token=token)


@admin_router.get("/{drop_id}", response_model=DropOut)
async def get_drop(
    drop_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.require_crm),
) -> DropOut:
    """What has arrived so far; the drawer polls this while its QR is up."""
    return await _out(session, await _admin_drop(session, ctx.store.id, drop_id))


@admin_router.get("/{drop_id}/files/{file_id}/thumb")
async def drop_file_thumb(
    drop_id: int,
    file_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.require_crm),
):
    drop = await _admin_drop(session, ctx.store.id, drop_id)
    f = await session.get(ProofDropFile, file_id)
    if f is None or f.drop_id != drop.id:
        raise HTTPException(status_code=404, detail="No such picture")
    return await preview(session, f.drive_file_id, f.mime_type)


@admin_router.delete("/{drop_id}/files/{file_id}", status_code=204)
async def remove_drop_file(
    drop_id: int,
    file_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.require_crm),
) -> None:
    """Take back one picture the phone sent (binned in Drive)."""
    drop = await _admin_drop(session, ctx.store.id, drop_id)
    f = await session.get(ProofDropFile, file_id)
    if f is None or f.drop_id != drop.id:
        raise HTTPException(status_code=404, detail="No such picture")
    try:
        await gdrive.trash(session, f.drive_file_id)
    except gdrive.DriveError as err:
        raise _drive_http(err)
    await session.delete(f)
    await session.commit()


@admin_router.post("/{drop_id}/attach/{expense_id}", response_model=list[ExpenseProofOut])
async def attach_drop(
    drop_id: int,
    expense_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.require_crm),
) -> list[ExpenseProofOut]:
    """File the phone's pictures with a saved expense: each moves from
    Incoming into the folder of the day the expense was spent and becomes
    one of its proofs. The drop is then used up."""
    drop = await _admin_drop(session, ctx.store.id, drop_id)
    expense = await _get(session, ctx.store.id, expense_id)
    files = await _files(session, drop)
    have = await session.scalar(
        select(func.count()).where(
            ExpenseProof.store_id == ctx.store.id, ExpenseProof.expense_id == expense.id
        )
    ) or 0
    if have + len(files) > MAX_PROOFS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_PROOFS} proofs per expense")
    store = await session.get(Store, ctx.store.id)
    day = expense.spent_at.astimezone(DHAKA).date().isoformat()
    for n, f in enumerate(files, start=have + 1):
        try:
            await gdrive.in_folder(
                session, store, gdrive.day_path(day), lambda to: gdrive.move(session, f.drive_file_id, to)
            )
            await gdrive.rename(
                session, f.drive_file_id, f"E{expense.id}-{n} {_safe_name(expense.item)}.{_ext(f)}"
            )
        except gdrive.DriveError as err:
            raise _drive_http(err)
        session.add(
            ExpenseProof(
                store_id=ctx.store.id,
                expense_id=expense.id,
                drive_file_id=f.drive_file_id,
                filename=f.filename,
                mime_type=f.mime_type,
                size=f.size,
                created_by_id=ctx.user.id,
            )
        )
        # One at a time, so a failure part-way leaves the rest in the drop.
        await session.delete(f)
        await session.commit()
    await session.delete(drop)
    await session.commit()
    rows = await session.scalars(
        select(ExpenseProof)
        .where(ExpenseProof.store_id == ctx.store.id, ExpenseProof.expense_id == expense.id)
        .order_by(ExpenseProof.created_at, ExpenseProof.id)
    )
    return [ExpenseProofOut.model_validate(p) for p in rows]


@admin_router.delete("/{drop_id}", status_code=204)
async def discard_drop(
    drop_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.require_crm),
) -> None:
    """The drawer closed without saving: bin what arrived."""
    await _discard(session, await _admin_drop(session, ctx.store.id, drop_id))


def _ext(f: ProofDropFile) -> str:
    return {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "application/pdf": "pdf",
    }.get(f.mime_type, "bin")


# --- The phone's side (no sign-in: the link's secret is the key) ----------------------


async def _public_drop(session: AsyncSession, token: str) -> ProofDrop:
    # A secret is 43 url-safe characters; anything else is not one of ours.
    if not 20 <= len(token) <= 100:
        raise HTTPException(status_code=404, detail="This link is not valid")
    drop = await session.scalar(select(ProofDrop).where(ProofDrop.token_hash == _hash(token)))
    if drop is None:
        raise HTTPException(status_code=404, detail="This link is not valid")
    if drop.expires_at < _now():
        raise HTTPException(
            status_code=410, detail="This link has expired. Show a new QR code on the computer."
        )
    return drop


async def _received(session: AsyncSession, drop: ProofDrop) -> int:
    return await session.scalar(
        select(func.count()).where(
            ProofDropFile.store_id == drop.store_id, ProofDropFile.drop_id == drop.id
        )
    ) or 0


@public_router.get("/{token}", response_model=DropPublicOut)
async def drop_info(token: str, session: AsyncSession = Depends(get_session)) -> DropPublicOut:
    drop = await _public_drop(session, token)
    store = await session.get(Store, drop.store_id)
    return DropPublicOut(
        store_name=store.name if store else "",
        expires_at=drop.expires_at,
        received=await _received(session, drop),
        max_files=MAX_PROOFS,
        max_bytes=settings.max_proof_bytes,
    )


@public_router.post("/{token}/files", response_model=DropPublicOut, status_code=201)
async def drop_upload(
    token: str,
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
) -> DropPublicOut:
    """Pictures from the phone, straight on to Google Drive. Checked by their
    bytes (JPEG, PNG, WebP, GIF, PDF) and size before anything is sent."""
    drop = await _public_drop(session, token)
    if not files:
        raise HTTPException(status_code=400, detail="No files")
    if await _received(session, drop) + len(files) > MAX_PROOFS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_PROOFS} pictures")
    limit = settings.max_proof_bytes
    checked: list[tuple[UploadFile, bytes, str, str]] = []
    for upload in files:
        data = await upload.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(
                status_code=413,
                detail=f"{upload.filename}: larger than {limit // (1024 * 1024)} MB",
            )
        kind = _sniff(data)
        if kind is None:
            raise HTTPException(
                status_code=415, detail=f"{upload.filename}: not a photo or PDF we can take"
            )
        checked.append((upload, data, *kind))

    store = await session.get(Store, drop.store_id)
    for upload, data, mime, ext in checked:
        name = f"phone-{drop.id}-{secrets.token_hex(3)}.{ext}"
        try:
            file_id = await gdrive.in_folder(
                session,
                store,
                gdrive.INCOMING,
                lambda folder: gdrive.upload(session, folder, name, mime, data),
            )
        except gdrive.DriveError as err:
            log.warning("Drive: a phone upload failed: %s", err.message)
            raise HTTPException(
                status_code=502, detail="Could not save to Google Drive. Try again."
            )
        session.add(
            ProofDropFile(
                store_id=drop.store_id,
                drop_id=drop.id,
                drive_file_id=file_id,
                filename=_safe_name(upload.filename or name, 255),
                mime_type=mime,
                size=len(data),
            )
        )
        await session.commit()
    return await drop_info(token, session)
