"""The CRM's Expenses page: what a store spends, by day.

Per store like everything else, for super admins and the people a super
admin gave CRM access in this store (tenancy.require_crm). The moment an
expense is spent is the
moment it is saved — the browser never names it. An expense is put down to
the person who adds it; only a super admin may write in another name, for
money someone else paid out.
"""
import io
import logging
from collections import OrderedDict
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import tenancy
from api.config import settings
from api.db import get_session
from api.models import Expense, ExpenseCategory, ExpenseProof, Store
from api.services import gdrive
from api.schemas import (
    ExpenseAmount,
    ExpenseCategoryIn,
    ExpenseCategoryOut,
    ExpenseIn,
    ExpenseOut,
    ExpenseProofOut,
    ExpenseProofRef,
    ExpenseSummaryOut,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/expenses", tags=["Expenses"])

# Every store has these, with these icons (Lucide keys); a store's owner can
# add more (expense_categories), each with an icon of their choosing.
DEFAULT_CATEGORIES = (
    ("Market & Grocery", "shopping-basket"),
    ("Packaging", "package"),
    ("Courier", "truck"),
    ("Utilities", "zap"),
    ("Salary", "users"),
    ("Equipment", "wrench"),
    ("Miscellaneous", "shapes"),
)

DHAKA = timezone(timedelta(hours=6), "Asia/Dhaka")

_require = tenancy.require_crm


def _today() -> date:
    return datetime.now(DHAKA).date()


def _day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, time.min, tzinfo=DHAKA)
    return start, start + timedelta(days=1)


def _dhaka_date(column):
    # The zone is written into the SQL, not bound, so SELECT and GROUP BY
    # carry the identical expression (see orders._dhaka_date).
    return func.date(func.timezone(literal_column("'Asia/Dhaka'"), column))


def _display_name(ctx: tenancy.StoreContext) -> str:
    return ctx.user.nickname or ctx.user.name


async def _categories(session: AsyncSession, store_id: int) -> list[ExpenseCategoryOut]:
    own = await session.execute(
        select(ExpenseCategory.id, ExpenseCategory.name, ExpenseCategory.icon)
        .where(ExpenseCategory.store_id == store_id)
        .order_by(ExpenseCategory.created_at, ExpenseCategory.id)
    )
    return [
        ExpenseCategoryOut(name=n, icon=i, default=True) for n, i in DEFAULT_CATEGORIES
    ] + [ExpenseCategoryOut(id=k, name=n, icon=i, default=False) for k, n, i in own]


async def _check_category(session: AsyncSession, store_id: int, name: str) -> None:
    if name not in {c.name for c in await _categories(session, store_id)}:
        raise HTTPException(status_code=400, detail="Pick one of the store's categories")


def _apply(
    expense: Expense, body: ExpenseIn, ctx: tenancy.StoreContext, *, new: bool
) -> None:
    """Copy the drawer's fields onto an expense.

    "Added by" is the signed-in user on a new expense. A super admin may write
    in another name, on a new expense or an old one; from anyone else the
    field is ignored, so an owner can neither pose as someone else nor rewrite
    who an existing expense is put down to."""
    expense.category = body.category
    expense.item = body.item
    expense.amount = body.amount
    expense.payment_method = body.payment_method
    expense.note = body.note or None
    own = _display_name(ctx)
    name = (body.added_by_name or "") if ctx.is_super_admin else ""
    if name and name != own:
        expense.added_by_name, expense.added_by_id = name, None
    elif new or name:
        expense.added_by_name, expense.added_by_id = own, ctx.user.id


async def _get(session: AsyncSession, store_id: int, expense_id: int) -> Expense:
    expense = await session.get(Expense, expense_id)
    if expense is None or expense.store_id != store_id:
        raise HTTPException(status_code=404, detail="No such expense")
    return expense


@router.get("/categories", response_model=list[ExpenseCategoryOut])
async def list_categories(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ExpenseCategoryOut]:
    """The defaults every store has, then the store's own, oldest first."""
    return await _categories(session, ctx.store.id)


@router.post("/categories", response_model=list[ExpenseCategoryOut], status_code=201)
async def add_category(
    body: ExpenseCategoryIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ExpenseCategoryOut]:
    """Add a category to the store; returns the whole list. A name already
    there, in any letter case, is refused rather than duplicated."""
    existing = await _categories(session, ctx.store.id)
    if body.name.casefold() in {c.name.casefold() for c in existing}:
        raise HTTPException(status_code=409, detail="That category already exists")
    session.add(ExpenseCategory(store_id=ctx.store.id, name=body.name, icon=body.icon))
    await session.commit()
    return await _categories(session, ctx.store.id)


@router.delete("/categories/{category_id}", response_model=list[ExpenseCategoryOut])
async def delete_category(
    category_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ExpenseCategoryOut]:
    """Remove one of the store's own categories; returns the whole list.
    Expenses already filed under it keep the name they were saved with, so
    the past reads as it was. The defaults have no id and cannot be removed."""
    category = await session.get(ExpenseCategory, category_id)
    if category is None or category.store_id != ctx.store.id:
        raise HTTPException(status_code=404, detail="No such category")
    await session.delete(category)
    await session.commit()
    return await _categories(session, ctx.store.id)


@router.get("", response_model=list[ExpenseOut])
async def list_expenses(
    day: date | None = Query(None),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ExpenseOut]:
    """One Dhaka day's expenses (today by default), in the order spent."""
    start, end = _day_bounds(day or _today())
    rows = await session.scalars(
        select(Expense)
        .where(
            Expense.store_id == ctx.store.id,
            Expense.spent_at >= start,
            Expense.spent_at < end,
        )
        .order_by(Expense.spent_at, Expense.id)
    )
    expenses = list(rows)
    proofs: dict[int, list[ExpenseProofRef]] = {}
    if expenses:
        for expense_id, proof_id, mime in await session.execute(
            select(ExpenseProof.expense_id, ExpenseProof.id, ExpenseProof.mime_type)
            .where(
                ExpenseProof.store_id == ctx.store.id,
                ExpenseProof.expense_id.in_([e.id for e in expenses]),
            )
            .order_by(ExpenseProof.created_at, ExpenseProof.id)
        ):
            proofs.setdefault(expense_id, []).append(
                ExpenseProofRef(id=proof_id, mime_type=mime)
            )
    return [
        ExpenseOut.model_validate(e).model_copy(
            update={"proofs": proofs.get(e.id, []), "proof_count": len(proofs.get(e.id, []))}
        )
        for e in expenses
    ]


@router.post("", response_model=ExpenseOut, status_code=201)
async def add_expense(
    body: ExpenseIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ExpenseOut:
    """Record an expense, spent now."""
    await _check_category(session, ctx.store.id, body.category)
    expense = Expense(store_id=ctx.store.id, created_by_id=ctx.user.id)
    _apply(expense, body, ctx, new=True)
    session.add(expense)
    await session.commit()
    await session.refresh(expense)
    return ExpenseOut.model_validate(expense)


@router.put("/{expense_id}", response_model=ExpenseOut)
async def edit_expense(
    expense_id: int,
    body: ExpenseIn,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ExpenseOut:
    """Correct an expense. When it was spent never changes; who it is put
    down to changes only when a super admin writes in a name."""
    expense = await _get(session, ctx.store.id, expense_id)
    await _check_category(session, ctx.store.id, body.category)
    _apply(expense, body, ctx, new=False)
    await session.commit()
    await session.refresh(expense)
    return ExpenseOut.model_validate(expense)


@router.delete("/{expense_id}", status_code=204)
async def delete_expense(
    expense_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> None:
    """Delete an expense and move its proofs to Drive's bin (recoverable
    there for 30 days). A Drive hiccup does not stop the delete: the rows go
    regardless, and the files are only left in the folder."""
    expense = await _get(session, ctx.store.id, expense_id)
    file_ids = (
        await session.scalars(
            select(ExpenseProof.drive_file_id).where(
                ExpenseProof.store_id == ctx.store.id, ExpenseProof.expense_id == expense.id
            )
        )
    ).all()
    for file_id in file_ids:
        try:
            await gdrive.trash(session, file_id)
        except gdrive.DriveError as err:
            log.warning("Drive: could not bin a proof of expense %s: %s", expense.id, err.message)
    await session.delete(expense)
    await session.commit()


# --- Proofs ------------------------------------------------------------------------

# What a proof may be, recognised by its first bytes rather than by what the
# browser claims: (mime type, extension).
_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"GIF87a", "image/gif", "gif"),
    (b"GIF89a", "image/gif", "gif"),
    (b"%PDF-", "application/pdf", "pdf"),
)
MAX_PROOFS = 10


def _sniff(data: bytes) -> tuple[str, str] | None:
    """(mime type, extension) for a JPEG, PNG, WebP, GIF or PDF; else None."""
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    for magic, mime, ext in _SIGNATURES:
        if data.startswith(magic):
            return mime, ext
    return None


def _drive_http(err: gdrive.DriveError) -> HTTPException:
    if isinstance(err, gdrive.DriveNotConnected):
        return HTTPException(status_code=409, detail=err.message)
    return HTTPException(status_code=502, detail=err.message)


def _safe_name(text: str, limit: int = 60) -> str:
    """Text fit for a Drive file name: no slashes or control characters."""
    cleaned = "".join(c if c.isprintable() and c not in '/\\' else " " for c in text)
    return " ".join(cleaned.split())[:limit] or "proof"


async def _get_proof(session: AsyncSession, store_id: int, proof_id: int) -> ExpenseProof:
    proof = await session.get(ExpenseProof, proof_id)
    if proof is None or proof.store_id != store_id:
        raise HTTPException(status_code=404, detail="No such proof")
    return proof


@router.get("/{expense_id}/proofs", response_model=list[ExpenseProofOut])
async def list_proofs(
    expense_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ExpenseProofOut]:
    expense = await _get(session, ctx.store.id, expense_id)
    rows = await session.scalars(
        select(ExpenseProof)
        .where(ExpenseProof.store_id == ctx.store.id, ExpenseProof.expense_id == expense.id)
        .order_by(ExpenseProof.created_at, ExpenseProof.id)
    )
    return [ExpenseProofOut.model_validate(p) for p in rows]


@router.post("/{expense_id}/proofs", response_model=list[ExpenseProofOut], status_code=201)
async def add_proofs(
    expense_id: int,
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ExpenseProofOut]:
    """Attach receipts or screenshots to an expense: JPEG, PNG, WebP, GIF or
    PDF, each up to MAX_PROOF_BYTES. They go to Google Drive, into
    nbPlatform / <store> / Expenses / <day the expense was spent>; only their
    ids are kept here. Returns all of the expense's proofs."""
    expense = await _get(session, ctx.store.id, expense_id)
    have = await session.scalar(
        select(func.count()).where(
            ExpenseProof.store_id == ctx.store.id, ExpenseProof.expense_id == expense.id
        )
    )
    if not files:
        raise HTTPException(status_code=400, detail="No files")
    if (have or 0) + len(files) > MAX_PROOFS:
        raise HTTPException(
            status_code=400, detail=f"At most {MAX_PROOFS} proofs per expense"
        )

    # Read and check everything before uploading anything.
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
                status_code=415,
                detail=f"{upload.filename}: not a JPEG, PNG, WebP, GIF or PDF",
            )
        checked.append((upload, data, *kind))

    store = await session.get(Store, ctx.store.id)
    day = expense.spent_at.astimezone(DHAKA).date().isoformat()
    n = have or 0
    for upload, data, mime, ext in checked:
        n += 1
        name = f"E{expense.id}-{n} {_safe_name(expense.item)}.{ext}"
        try:
            file_id = await gdrive.upload_to_day(session, store, day, name, mime, data)
        except gdrive.DriveError as err:
            raise _drive_http(err)
        session.add(
            ExpenseProof(
                store_id=ctx.store.id,
                expense_id=expense.id,
                drive_file_id=file_id,
                filename=_safe_name(upload.filename or name, 255),
                mime_type=mime,
                size=len(data),
                created_by_id=ctx.user.id,
            )
        )
        # Saved one by one: if a later file fails, the earlier ones stay
        # attached rather than orphaned in Drive.
        await session.commit()
    return await list_proofs(expense.id, session, ctx)


@router.get("/proofs/{proof_id}/file")
async def proof_file(
    proof_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> Response:
    """The proof itself, fetched from Drive for someone allowed the CRM. The
    file stays private in Drive; this is the only way to it."""
    proof = await _get_proof(session, ctx.store.id, proof_id)
    try:
        data = await gdrive.download(session, proof.drive_file_id)
    except gdrive.DriveError as err:
        if err.status == 404:
            raise HTTPException(status_code=404, detail="The file is no longer in Google Drive")
        raise _drive_http(err)
    return Response(
        content=data,
        media_type=proof.mime_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            # RFC 5987, so a Bangla file name survives the latin-1 header.
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(proof.filename)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


# Recent thumbnails, by proof id: the table shows one per row and a day's
# list is reloaded often. Small (≈20 KB each), so a few hundred cost little.
# Keyed by Drive file id, which a file keeps when it moves folders.
_THUMBS: OrderedDict[str, bytes] = OrderedDict()
_THUMBS_MAX = 400
THUMB_PX = 320


def _shrink(data: bytes) -> bytes | None:
    """A JPEG at most THUMB_PX on its longest side, for when Drive has no
    preview yet; None if Pillow cannot read the image."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB_PX, THUMB_PX))
            out = io.BytesIO()
            im.convert("RGB").save(out, "JPEG", quality=80)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, ValueError):
        return None


@router.get("/proofs/{proof_id}/thumb")
async def proof_thumb(
    proof_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> Response:
    """A small preview of a proof for the table: Drive's own (it makes them
    for photos and PDFs), else the photo shrunk here. 404 when there is none
    yet — a PDF Drive has not previewed — and the table shows an icon."""
    proof = await _get_proof(session, ctx.store.id, proof_id)
    return await preview(session, proof.drive_file_id, proof.mime_type)


async def preview(session: AsyncSession, file_id: str, mime_type: str) -> Response:
    """A Drive file's small preview as a response, from the cache when it
    can be. Shared with the phone-upload drops."""
    data = _THUMBS.get(file_id)
    if data is None:
        try:
            data = await gdrive.thumbnail(session, file_id, THUMB_PX)
            if data is None and mime_type.startswith("image/"):
                data = await run_in_threadpool(_shrink, await gdrive.download(session, file_id))
        except gdrive.DriveError as err:
            if err.status == 404:
                raise HTTPException(status_code=404, detail="The file is no longer in Google Drive")
            raise _drive_http(err)
        if data is None:
            raise HTTPException(status_code=404, detail="No preview yet")
        _THUMBS[file_id] = data
        if len(_THUMBS) > _THUMBS_MAX:
            _THUMBS.popitem(last=False)
    else:
        _THUMBS.move_to_end(file_id)
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/proofs/{proof_id}", status_code=204)
async def delete_proof(
    proof_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> None:
    """Detach a proof and move its file to Drive's bin."""
    proof = await _get_proof(session, ctx.store.id, proof_id)
    try:
        await gdrive.trash(session, proof.drive_file_id)
    except gdrive.DriveError as err:
        raise _drive_http(err)
    _THUMBS.pop(proof.drive_file_id, None)
    await session.delete(proof)
    await session.commit()


@router.get("/summary", response_model=ExpenseSummaryOut)
async def summary(
    day: date | None = Query(None),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> ExpenseSummaryOut:
    """The page's figures: the day, the day before, the month so far against
    the same days last month, and the day by category."""
    d = day or _today()
    if d > _today():
        raise HTTPException(status_code=400, detail="That day has not happened yet")
    store_id = ctx.store.id

    async def total(start: datetime, end: datetime) -> int:
        return await session.scalar(
            select(func.coalesce(func.sum(Expense.amount), 0)).where(
                Expense.store_id == store_id,
                Expense.spent_at >= start,
                Expense.spent_at < end,
            )
        )

    day_start, day_end = _day_bounds(d)
    month_start = datetime(d.year, d.month, 1, tzinfo=DHAKA)
    # The same days of last month: 1st to the same date, or its last day if
    # last month is shorter (31 March compares with 1–28/29 February).
    prev_first = (month_start - timedelta(days=1)).replace(day=1)
    prev_end = min(prev_first + timedelta(days=d.day), month_start)

    day_count = await session.scalar(
        select(func.count()).where(
            Expense.store_id == store_id,
            Expense.spent_at >= day_start,
            Expense.spent_at < day_end,
        )
    )

    by_category = await session.execute(
        select(Expense.category, func.sum(Expense.amount))
        .where(
            Expense.store_id == store_id,
            Expense.spent_at >= day_start,
            Expense.spent_at < day_end,
        )
        .group_by(Expense.category)
        .order_by(func.sum(Expense.amount).desc(), Expense.category)
    )

    return ExpenseSummaryOut(
        day=d,
        day_total=await total(day_start, day_end),
        day_count=day_count or 0,
        previous_day_total=await total(day_start - timedelta(days=1), day_start),
        month_total=await total(month_start, day_end),
        previous_month_total=await total(prev_first, prev_end),
        by_category=[ExpenseAmount(label=c, amount=a) for c, a in by_category],
    )


@router.get("/trend", response_model=list[ExpenseAmount])
async def trend(
    day: date | None = Query(None),
    days: int = Query(7, ge=1, le=366),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(_require),
) -> list[ExpenseAmount]:
    """Total spent on each of the `days` Dhaka days ending on `day` (today by
    default), oldest first, days with nothing included as 0 so the chart's
    axis has no gaps. label is the ISO date."""
    d = day or _today()
    if d > _today():
        raise HTTPException(status_code=400, detail="That day has not happened yet")
    _, end = _day_bounds(d)
    start = end - timedelta(days=days)
    spent_on = _dhaka_date(Expense.spent_at)
    per_day = dict(
        (
            await session.execute(
                select(spent_on, func.sum(Expense.amount))
                .where(
                    Expense.store_id == ctx.store.id,
                    Expense.spent_at >= start,
                    Expense.spent_at < end,
                )
                .group_by(spent_on)
            )
        ).all()
    )
    span = [d - timedelta(days=i) for i in range(days - 1, -1, -1)]
    return [ExpenseAmount(label=x.isoformat(), amount=per_day.get(x, 0)) for x in span]
