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
"""

from __future__ import annotations

import secrets
from pathlib import Path

from api.config import settings

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
    """Write an image under `subdir` and return its path relative to the
    media root.

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
    directory = media_root() / subdir
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}{extension}"
    (directory / name).write_bytes(data)
    return f"{subdir}/{name}"


def delete_media(relative_path: str | None) -> None:
    """Remove a stored file, ignoring one that has already gone.

    Resolves the path and confirms it is still inside the media root, so a
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
    target.unlink(missing_ok=True)
