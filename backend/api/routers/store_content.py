"""A store's own pictures for its template.

The template (frontend templates/catalog.ts) declares which fields exist —
logo, banner, and so on — each with a default picture shipped with the app.
Here the store owner replaces a default with an upload, or goes back to it.
The API does not know the field list: any well-formed key is accepted, and
the frontend only offers the keys the store's template has. Storage is
stores.content, key -> media path; the public config turns paths into URLs.
"""
import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from api import media, stores
from api.db import get_session
from api.models import Store
from api.routers.store_settings import settings_store
from api import tenancy

router = APIRouter(prefix="/stores", tags=["Stores"])

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


class StoreContentOut(BaseModel):
    template: str
    # key -> URL of the store's own picture; keys not present use the default.
    content: dict[str, str]


def _check_key(key: str) -> None:
    if not KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Bad content key")


async def _store(session: AsyncSession, store_id: int) -> Store:
    store = await session.get(Store, store_id)
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found")
    return store


def _out(store: Store) -> StoreContentOut:
    return StoreContentOut(
        template=store.template,
        content={k: stores.content_url(v) for k, v in (store.content or {}).items()},
    )


@router.get("/{store_id}/content", response_model=StoreContentOut)
async def get_content(
    store_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreContentOut:
    return _out(await _store(session, ctx.store.id))


@router.put("/{store_id}/content/{key}", response_model=StoreContentOut)
async def upload_content_image(
    store_id: int,
    key: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreContentOut:
    """Replace the template's default picture for `key` with this upload."""
    _check_key(key)
    store = await _store(session, ctx.store.id)
    data = await file.read()
    try:
        path = media.save_image(data, f"stores/{store.id}")
    except media.UploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    content = dict(store.content or {})
    previous = content.get(key)
    content[key] = path
    store.content = content
    flag_modified(store, "content")
    await session.commit()
    # Only after the commit, so a failed save never orphans the row's picture.
    if previous and not previous.startswith("/"):
        media.delete_media(previous)
    stores.invalidate()
    return _out(store)


@router.delete("/{store_id}/content/{key}", response_model=StoreContentOut)
async def reset_content_image(
    store_id: int,
    key: str,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(settings_store),
) -> StoreContentOut:
    """Back to the template's default for `key`."""
    _check_key(key)
    store = await _store(session, ctx.store.id)
    content = dict(store.content or {})
    previous = content.pop(key, None)
    store.content = content
    flag_modified(store, "content")
    await session.commit()
    if previous and not previous.startswith("/"):
        media.delete_media(previous)
    stores.invalidate()
    return _out(store)
