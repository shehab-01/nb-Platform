"""Make the resized WebP copies for uploads that predate them.

Every new upload gets its copies at upload time (api.media.save_image); this
walks the media volume once for the ones that were there before, and again
after a change of WEBP_QUALITY or VARIANT_WIDTHS with --force. Originals are
never touched. Safe to re-run: copies that exist are skipped unless forced.

Run inside the api container:

    docker compose exec api python -m scripts.backfill_image_variants
    docker compose exec api python -m scripts.backfill_image_variants --force
"""
from __future__ import annotations

import argparse
import sys

from api import media


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--force", action="store_true", help="rewrite copies that already exist"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="list what would be made, write nothing"
    )
    args = parser.parse_args(argv)

    root = media.media_root()
    if not root.is_dir():
        print(f"no media directory at {root}", file=sys.stderr)
        return 1
    originals = sorted(
        p for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in media.VARIANT_SOURCES
        and not media.is_variant(p.name)
    )
    made = skipped = 0
    for path in originals:
        relative = path.relative_to(root).as_posix()
        if args.dry_run:
            missing = [
                w for w in media.VARIANT_WIDTHS
                if not (root / media.variant_path(relative, w)).exists()
            ]
            print(f"{relative}: would try {missing or 'nothing'}")
            continue
        widths = media.generate_variants(relative, force=args.force)
        if widths:
            made += 1
            print(f"{relative}: {', '.join(str(w) for w in widths)}")
        else:
            skipped += 1
    print(f"{len(originals)} uploads: {made} with new copies, {skipped} unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
