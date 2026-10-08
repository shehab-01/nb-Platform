"""
api.services.gdrive and the proof rules around it: what may be uploaded, how
names are made safe for Drive, and that the OAuth round trip cannot be forged.
No network and no database.

Run from backend/:  python -m pytest tests -q
"""
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

from api.config import settings
from api.routers import drive
from api.routers.expenses import _safe_name, _sniff
from api.services import gdrive


# --- what a proof may be ------------------------------------------------------------


@pytest.mark.parametrize(
    "head, kind",
    [
        (b"\xff\xd8\xff\xe0rest", ("image/jpeg", "jpg")),
        (b"\x89PNG\r\n\x1a\nrest", ("image/png", "png")),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", ("image/webp", "webp")),
        (b"GIF89a....", ("image/gif", "gif")),
        (b"%PDF-1.7\n", ("application/pdf", "pdf")),
    ],
)
def test_proofs_are_recognised_by_their_bytes(head, kind):
    assert _sniff(head) == kind


@pytest.mark.parametrize(
    "head",
    [b"<html><script>", b"MZ\x90\x00", b"PK\x03\x04", b"", b"RIFF\x00\x00\x00\x00WAVE"],
)
def test_anything_else_is_refused_whatever_it_is_called(head):
    assert _sniff(head) is None


def test_drive_names_lose_slashes_and_control_characters():
    assert _safe_name("Jar 200g / 50 pcs\n\tlid") == "Jar 200g 50 pcs lid"
    assert _safe_name("  ") == "proof"
    assert len(_safe_name("x" * 500)) == 60


def test_names_in_drive_queries_are_escaped():
    assert gdrive._quote("Rafi's \\ shop") == "Rafi\\'s \\\\ shop"


# --- the OAuth round trip -----------------------------------------------------------


@pytest.fixture
def oauth(monkeypatch):
    monkeypatch.setattr(settings, "google_drive_client_id", "client-id")
    monkeypatch.setattr(settings, "google_drive_client_secret", "client-secret")
    monkeypatch.setattr(
        settings, "google_drive_redirect_uri", "http://localhost:8090/api/drive/oauth/callback"
    )
    monkeypatch.setattr(settings, "session_secret", "test-secret")


def test_configured_needs_all_three_settings(oauth, monkeypatch):
    assert gdrive.configured()
    monkeypatch.setattr(settings, "google_drive_client_secret", "")
    assert not gdrive.configured()


def test_consent_asks_only_for_the_apps_own_files_and_a_refresh_token(oauth):
    q = parse_qs(urlsplit(gdrive.authorization_url("STATE")).query)
    assert q["scope"] == ["https://www.googleapis.com/auth/drive.file"]
    assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"]
    assert q["state"] == ["STATE"] and q["client_id"] == ["client-id"]
    # The secret never travels in the browser.
    assert "client_secret" not in q


def test_a_forged_state_is_refused(oauth):
    import asyncio

    with pytest.raises(HTTPException) as err:
        asyncio.run(drive.callback(state="not-a-signed-state", code="x", error=None, session=None))
    assert err.value.status_code == 400


def test_a_state_signed_with_another_secret_is_refused(oauth, monkeypatch):
    import asyncio

    forged = drive._signer().dumps({"uid": 1, "back": "https://evil.example"})
    monkeypatch.setattr(settings, "session_secret", "the-real-secret")
    with pytest.raises(HTTPException) as err:
        asyncio.run(drive.callback(state=forged, code="x", error=None, session=None))
    assert err.value.status_code == 400


def test_a_photo_without_a_drive_preview_is_shrunk_here():
    import io

    from PIL import Image

    from api.routers.expenses import THUMB_PX, _shrink

    big = io.BytesIO()
    Image.new("RGB", (2000, 1000), "red").save(big, "PNG")
    out = Image.open(io.BytesIO(_shrink(big.getvalue())))
    assert out.format == "JPEG" and max(out.size) == THUMB_PX
    assert _shrink(b"%PDF-1.7 not an image") is None
