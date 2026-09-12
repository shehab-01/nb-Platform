"""api.media: the resized WebP copies of an upload, and how /media is served.

Run from backend/:  python -m pytest tests -q
"""
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from api import media
from api.config import settings


def jpeg(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (200, 120, 40)).save(buf, "JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def media_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "media_root", str(tmp_path))
    media._described.clear()
    yield tmp_path


def test_upload_writes_original_and_only_smaller_copies(media_dir):
    path = media.save_image(jpeg(1300, 900), "products")
    assert (media_dir / path).read_bytes()[:3] == b"\xff\xd8\xff"  # untouched
    copies = sorted(p.name for p in (media_dir / "products").iterdir() if media.is_variant(p.name))
    stem = path.split("/")[1].rsplit(".", 1)[0]
    # 1600 and 2000 are wider than the original: never upscaled. 1300 itself
    # is made, so the widest copy is a re-encode rather than a downscale.
    assert copies == sorted(f"{stem}-w{w}.webp" for w in (480, 800, 1200, 1300))
    with Image.open(media_dir / media.variant_path(path, 800)) as im:
        assert im.format == "WEBP" and im.size == (800, 554)


def test_describe_gives_size_and_srcset(media_dir):
    path = media.save_image(jpeg(1300, 900), "products")
    info = media.describe(path)
    assert (info.width, info.height) == (1300, 900)
    assert info.srcset == ", ".join(
        f"/media/{media.variant_path(path, w)} {w}w" for w in (480, 800, 1200, 1300)
    )


def test_small_upload_gets_one_copy_at_its_own_width(media_dir):
    """Nothing is upscaled, but a WebP re-encode at native size is still worth
    having: a small PNG upload can be many times the size of its copy."""
    path = media.save_image(jpeg(300, 300), "products")
    assert media.describe(path).srcset == f"/media/{media.variant_path(path, 300)} 300w"
    copies = [p.name for p in (media_dir / "products").iterdir() if media.is_variant(p.name)]
    assert copies == [path.split("/")[1].rsplit(".", 1)[0] + "-w300.webp"]


def test_variant_widths_never_upscale_and_keep_the_native_width():
    assert media.variant_widths(300) == (300,)
    assert media.variant_widths(480) == (480,)
    assert media.variant_widths(1254) == (480, 800, 1200, 1254)
    assert media.variant_widths(2000) == (480, 800, 1200, 1600, 2000)
    # Past the cap the widest standard copy is enough: no 4000px WebP.
    assert media.variant_widths(4000) == (480, 800, 1200, 1600, 2000)


def test_describe_is_none_for_missing_or_empty():
    assert media.describe(None) is None
    assert media.describe("products/nope.jpg") is None


def test_unreadable_bytes_with_a_jpeg_signature_are_refused(media_dir):
    with pytest.raises(media.UploadError, match="not a readable image"):
        media.save_image(b"\xff\xd8\xff" + b"garbage" * 100, "products")
    assert list(media_dir.rglob("*")) == []


def test_delete_removes_the_copies_too(media_dir):
    path = media.save_image(jpeg(1000, 1000), "products")
    assert len(list((media_dir / "products").iterdir())) == 4  # original + 480 + 800 + 1000 (its own width)
    media.delete_media(path)
    assert list((media_dir / "products").iterdir()) == []


def test_backfill_makes_missing_copies_once(media_dir, capsys):
    from scripts import backfill_image_variants as backfill

    path = media.save_image(jpeg(900, 600), "products")
    # Pretend this upload predates copies.
    for w in media.VARIANT_WIDTHS:
        (media_dir / media.variant_path(path, w)).unlink(missing_ok=True)
    assert backfill.main([]) == 0
    assert (media_dir / media.variant_path(path, 800)).exists()
    assert "1 with new copies" in capsys.readouterr().out
    assert backfill.main([]) == 0
    assert "0 with new copies, 1 unchanged" in capsys.readouterr().out


def test_media_is_served_immutable_for_a_year(media_dir):
    path = media.save_image(jpeg(640, 480), "products")
    app = FastAPI()
    app.mount("/media", media.MediaFiles(directory=str(media_dir)), name="media")
    res = TestClient(app).get(f"/media/{path}")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert res.headers["content-type"] == "image/jpeg"
    webp = TestClient(app).get(f"/media/{media.variant_path(path, 480)}")
    assert webp.headers["content-type"] == "image/webp"
    assert webp.headers["cache-control"].endswith("immutable")
