"""Uploaded files on disk.

Images live under settings.media_root, which is a Docker volume mounted into
the container — writing anywhere else means losing every upload on the next
image rebuild. FastAPI serves the directory read-only at /media (see main.py)
and Next rewrites /media to the API, so a stored path like
"products/a1b2c3.jpg" is fetched by the browser as "/media/products/a1b2c3.jpg".

Uploads come from authenticated super admins only, but the checks here assume
nothing about the caller: the type is decided by sniffing the leading bytes
rather than by trusting the declared content type or the file name, and the
stored name is generated rather than taken from the upload.

Every upload is kept exactly as sent, and beside it a few resized WebP copies
are written once (VARIANT_WIDTHS, never wider than the original). The page
offers those through srcset with the original as the fallback, so a phone
downloads a picture its size instead of the full upload — and nothing is
resized or re-encoded per request. Quality is deliberately high (see
WEBP_QUALITY): this is a shop, and the photo is what sells.

File names are random and never reused, so a name always means the same
bytes; that is what lets /media be served with a one-year immutable cache.
"""

from __future__ import annotations

import io
import logging
import mimetypes
import secrets
import time
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.responses import Response
from starlette.staticfiles import StaticFiles

from api.config import settings

log = logging.getLogger("media")

# python:3.12-slim has no /etc/mime.types, so Starlette would serve the WebP
# copies as application/octet-stream. Registered here, where they are made.
mimetypes.add_type("image/webp", ".webp")

# Widths of the WebP copies, in CSS-pixel terms of the storefront column
# (560px at most): 480 for a small phone, 800/1200 for the usual 2x–3x
# phones and desktop, 1600/2000 so a large upload stays crisp on a 3x
# screen. Only widths up to the original's are made — never upscaled.
VARIANT_WIDTHS = (480, 800, 1200, 1600, 2000)
# An upload wider than the largest standard copy it covers also gets one at
# its own width (up to this), so the sharpest copy loses no pixels.
MAX_NATIVE_WIDTH = 2000
# 85–90 is where lossy WebP stops being visibly lossy on product photos; the
# default 75–80 shows in smooth gradients and fine text at 200%. Chosen after
# a side-by-side at 100% and 200% on real uploads (see the commit).
WEBP_QUALITY = 88
# libwebp's slowest, best encoder setting: upload-time only, so worth it.
WEBP_METHOD = 6
# Formats whose variants are worth making. GIF stays as is (a variant would
# freeze an animation); SVG is refused at upload.
VARIANT_SOURCES = {".jpg", ".png", ".webp"}
# Long enough that a sibling process's stat cache does not matter, short
# enough that a backfill shows up on its own.
DESCRIBE_TTL_SECONDS = 60.0

# Extension by magic number. Only formats a browser renders as an <img>, and
# deliberately not SVG: an SVG is a document that can carry script, and these
# files are served from the same origin as the admin.
_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
]

PRODUCT_DIR = "products"


class UploadError(Exception):
    """The upload was refused; `message` is safe to show to staff."""


def _extension_for(data: bytes) -> str:
    for signature, extension in _SIGNATURES:
        if data.startswith(signature):
            return extension
    # WEBP is "RIFF" + 4 size bytes + "WEBP", so it needs a gap in the match.
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    raise UploadError("Unsupported image type — use JPEG, PNG, GIF or WebP")


def media_root() -> Path:
    return Path(settings.media_root)


def save_product_image(data: bytes) -> str:
    return save_image(data, PRODUCT_DIR)


def save_image(data: bytes, subdir: str) -> str:
    """Write an image under `subdir`, with its resized copies, and return its
    path relative to the media root.

    The name is random, so an upload can never overwrite an existing file or
    escape the media directory via its own name. `subdir` comes from code,
    never from the request.
    """
    if not data:
        raise UploadError("The file is empty")
    if len(data) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes / (1024 * 1024)
        raise UploadError(f"Image is larger than {limit_mb:.0f} MB")

    extension = _extension_for(data)
    # Decode before writing anything: bytes that carry a JPEG signature but
    # are not a picture should be refused, not stored.
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise UploadError("The file is not a readable image") from exc
    directory = media_root() / subdir
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}{extension}"
    (directory / name).write_bytes(data)
    relative = f"{subdir}/{name}"
    generate_variants(relative)
    return relative


# --- resized copies ----------------------------------------------------------


def variant_path(relative_path: str, width: int) -> str:
    """"products/ab12.jpg", 800 -> "products/ab12-w800.webp"."""
    stem, _, _ = relative_path.rpartition(".")
    return f"{stem or relative_path}-w{width}.webp"


def variant_widths(original_width: int) -> tuple[int, ...]:
    """The copies an upload this wide gets: every standard width it covers,
    and its own width when that is larger than the last standard one (and
    not absurdly large), so the widest copy is a straight re-encode."""
    widths = [w for w in VARIANT_WIDTHS if w <= original_width]
    if original_width <= MAX_NATIVE_WIDTH and original_width not in widths:
        widths.append(original_width)
    return tuple(widths)


def is_variant(name: str) -> bool:
    """Whether a file name is one of our copies rather than an upload."""
    stem, _, ext = name.rpartition(".")
    return ext == "webp" and "-w" in stem and stem.rsplit("-w", 1)[1].isdigit()


def generate_variants(relative_path: str, *, force: bool = False) -> list[int]:
    """Write the WebP copies of one upload that are not there yet (all of
    them with `force`) and return the widths written. Never raises: a copy
    that cannot be made leaves the page serving the original, which is what
    it did before copies existed."""
    source = media_root() / relative_path
    if source.suffix.lower() not in VARIANT_SOURCES or not source.is_file():
        return []
    try:
        with Image.open(source) as im:
            # A phone photo's EXIF rotation, applied so the copy is upright
            # like the browser shows the original. Pixels are otherwise
            # untouched: no crop, no sharpening.
            im = ImageOps.exif_transpose(im)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
            written: list[int] = []
            for width in variant_widths(im.width):
                target = media_root() / variant_path(relative_path, width)
                if target.exists() and not force:
                    continue
                height = round(im.height * width / im.width)
                copy = im if width == im.width else im.resize(
                    (width, height), Image.Resampling.LANCZOS
                )
                copy.save(
                    target, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD
                )
                written.append(width)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        log.warning("no variants for %s: %s", relative_path, exc)
        return []
    _described.pop(relative_path, None)
    return written


@dataclass(frozen=True)
class ImageInfo:
    """What the page needs to lay out and pick a copy of one upload."""

    width: int
    height: int
    #: (width, url) of every copy on disk, narrowest first.
    variants: tuple[tuple[int, str], ...]

    @property
    def srcset(self) -> str | None:
        if not self.variants:
            return None
        return ", ".join(f"{url} {w}w" for w, url in self.variants)


_described: dict[str, tuple[float, ImageInfo | None]] = {}


def describe(relative_path: str | None) -> ImageInfo | None:
    """Size and available copies of an upload, or None when it is not a
    picture we can read. A few stats and one header read, cached briefly:
    the listing asks on every storefront page view."""
    if not relative_path:
        return None
    hit = _described.get(relative_path)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    info: ImageInfo | None = None
    source = media_root() / relative_path
    try:
        with Image.open(source) as im:
            im = ImageOps.exif_transpose(im)
            width, height = im.size
        variants = tuple(
            (w, f"/media/{variant_path(relative_path, w)}")
            for w in variant_widths(width)
            if (media_root() / variant_path(relative_path, w)).is_file()
        )
        info = ImageInfo(width=width, height=height, variants=variants)
    except (UnidentifiedImageError, OSError, ValueError):
        info = None
    if len(_described) > 5_000:
        _described.clear()
    _described[relative_path] = (time.monotonic() + DESCRIBE_TTL_SECONDS, info)
    return info


class MediaFiles(StaticFiles):
    """/media with a one-year immutable cache. Safe because a name is never
    reused: replacing a picture writes a new name and deletes the old."""

    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def delete_media(relative_path: str | None) -> None:
    """Remove a stored file and its copies, ignoring ones already gone.

    Resolves each path and confirms it is still inside the media root, so a
    value that somehow acquired "../" cannot delete anything else.
    """
    if not relative_path:
        return
    root = media_root().resolve()
    try:
        target = (root / relative_path).resolve()
        target.relative_to(root)
    except (ValueError, OSError):
        return
    # The copies sit beside the original as <stem>-w<width>.webp.
    for copy in target.parent.glob(f"{target.stem}-w*.webp"):
        if is_variant(copy.name):
            copy.unlink(missing_ok=True)
    target.unlink(missing_ok=True)
    _described.pop(relative_path, None)
