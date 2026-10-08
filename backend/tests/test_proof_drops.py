"""
api.routers.proof_drops: the phone-upload link's rules. No database.

Run from backend/:  python -m pytest tests -q
"""
import asyncio

import pytest
from fastapi import HTTPException

from api.routers import proof_drops


def test_only_a_hash_of_the_secret_is_kept():
    token = "k7Qx" * 11
    h = proof_drops._hash(token)
    assert h != token and len(h) == 64
    assert h == proof_drops._hash(token)  # the lookup key is stable
    assert h != proof_drops._hash(token + "x")


@pytest.mark.parametrize("token", ["", "short", "x" * 101])
def test_a_link_that_cannot_be_ours_is_refused_before_the_database(token):
    # session=None: reaching the database here would raise, not 404.
    with pytest.raises(HTTPException) as err:
        asyncio.run(proof_drops._public_drop(None, token))
    assert err.value.status_code == 404


def test_links_last_fifteen_minutes():
    assert proof_drops.DROP_MINUTES == 15


def test_the_phone_side_offers_only_reading_its_link_and_uploading():
    routes = {(r.path, tuple(sorted(r.methods))) for r in proof_drops.public_router.routes}
    assert routes == {
        ("/drop/{token}", ("GET",)),
        ("/drop/{token}/files", ("POST",)),
    }


def test_what_the_phone_learns_is_only_room_and_time():
    assert set(proof_drops.DropPublicOut.model_fields) == {
        "store_name",
        "expires_at",
        "received",
        "max_files",
        "max_bytes",
    }
