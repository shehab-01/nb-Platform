"""Archiving a store: only when inactive, never re-activated while archived,
and restore brings it back inactive. Endpoints called directly with a fake
session, no database.

Run from backend/:  python -m pytest tests -q
"""
import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from api.models import Store
from api.routers import stores as router
from api.schemas import StoreUpdate


class FakeSession:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.commits = 0

    async def get(self, model, store_id):
        return self.store if store_id == self.store.id else None

    async def commit(self) -> None:
        self.commits += 1

    def expire_all(self) -> None:
        pass


def _store(*, active: bool, archived: bool = False) -> Store:
    now = datetime.now(timezone.utc)
    return Store(
        id=7,
        slug="s7",
        name="Shop",
        subtitle=None,
        order_prefix="S7",
        template="classic",
        currency="BDT",
        theme={},
        is_active=active,
        archived_at=now if archived else None,
        domains=[],
        created_at=now,
        updated_at=now,
    )


def test_archive_refuses_an_active_store():
    session = FakeSession(_store(active=True))
    with pytest.raises(HTTPException) as err:
        asyncio.run(router.archive_store(7, session))
    assert err.value.status_code == 409
    assert session.store.archived_at is None
    assert session.commits == 0


def test_archive_stamps_an_inactive_store():
    session = FakeSession(_store(active=False))
    out = asyncio.run(router.archive_store(7, session))
    assert out.archived_at is not None
    assert out.is_active is False


def test_archived_store_cannot_be_activated():
    session = FakeSession(_store(active=False, archived=True))
    with pytest.raises(HTTPException) as err:
        asyncio.run(router.update_store(7, StoreUpdate(is_active=True), session))
    assert err.value.status_code == 409
    assert session.store.is_active is False


def test_restore_clears_archive_and_stays_inactive():
    session = FakeSession(_store(active=False, archived=True))
    out = asyncio.run(router.restore_store(7, session))
    assert out.archived_at is None
    assert out.is_active is False


def test_unknown_store_is_404():
    session = FakeSession(_store(active=False))
    with pytest.raises(HTTPException) as err:
        asyncio.run(router.archive_store(99, session))
    assert err.value.status_code == 404
