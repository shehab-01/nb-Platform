"""Pathao's address parser: free-text address in, Pathao city/zone/area out.

The endpoint is undocumented and lives on the merchant panel's host, not on
the courier API (see docs/PATHAO-ADDRESS-PARSER.md for what was verified and
why the courier API's bearer token works on it). Everything here assumes it
can stop working on any Pathao deploy:

- the answer is normalised into our own ParseResult, so nothing else in the
  app depends on Pathao's shape;
- every failure — timeout, 5xx, garbage, missing `data` — comes back as
  matched=False, never as an exception, so the order form always falls back
  to the dropdowns;
- a short timeout and a circuit breaker keep a dead endpoint from slowing
  every keystroke down;
- answers are cached in Postgres by a hash of the normalised address for two
  weeks, because most of what staff type is the same neighbourhoods and the
  endpoint is probably rate-limited.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.models import Order, PathaoAddressParse
from api.services import pathao
from api.stores import PathaoConfig

log = logging.getLogger("pathao_address")

# Pathao's own limits on what it will bother parsing. Under MIN_CHARS there is
# nothing to sort; over MAX_CHARS the text is cut, matching the booking.
MIN_CHARS = 10
MAX_CHARS = 220
TIMEOUT_SECONDS = 2.5
CACHE_TTL = timedelta(days=14)
# The breaker opens after this many failures in a row and stays open for the
# cooldown; while open, parse() answers matched=False without calling out.
BREAKER_FAILURES = 3
BREAKER_COOLDOWN_SECONDS = 120

# ibn_chain entry types that pin the address down to a street or a sector,
# as opposed to a whole upazila.
PRECISE_TYPES = {"transport", "subarea"}

Confidence = str  # "high" | "medium" | "low"


@dataclass(frozen=True)
class ParseResult:
    matched: bool
    city_id: int | None = None
    city_name: str | None = None
    zone_id: int | None = None
    zone_name: str | None = None
    area_id: int | None = None
    area_name: str | None = None
    confidence: Confidence = "low"
    # Pathao's full `data` blob (None when the call failed), for the order's
    # record and for tracing coarse parses later.
    raw: dict[str, Any] | None = None

    def as_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> ParseResult:
        fields = {name: data.get(name) for name in cls.__dataclass_fields__}
        fields["matched"] = bool(fields["matched"])
        fields["confidence"] = str(fields.get("confidence") or "low")
        return cls(**fields)


NO_MATCH = ParseResult(matched=False)

_BANGLA_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def normalise(address: str) -> str:
    """One cache key per address as people actually write it: whitespace and
    comma spacing collapsed, Bangla digits unified with Latin ones, Latin
    letters lower-cased (Bangla has no case). Stray trailing punctuation goes
    too, so "Uttara, Dhaka." and "uttara,dhaka" are the same place."""
    text = address.translate(_BANGLA_DIGITS)
    text = re.sub(r"\s*,\s*", ", ", text)
    text = re.sub(r"(, )+", ", ", text)
    text = " ".join(text.split())
    text = text.strip(" ,.;:-")
    return text.lower()


def cache_key(address: str) -> str:
    return hashlib.sha256(normalise(address).encode("utf-8")).hexdigest()


def enabled() -> bool:
    return bool(settings.pathao_parser_url)


# --- Reading Pathao's answer --------------------------------------------------


def _int(value: Any) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _str(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def confidence_of(data: dict[str, Any]) -> Confidence:
    """high when the zone is known and either Pathao's delivery history backs
    it or the chain reaches a road or sector; medium for a zone from a coarse
    chain; low without a zone."""
    if _int(data.get("zone_id")) is None:
        return "low"
    if data.get("history_verified") is True:
        return "high"
    chain = data.get("ibn_chain")
    if isinstance(chain, list) and chain:
        # The chain runs from the most specific place outwards, so the first
        # entry is the deepest one.
        deepest = chain[0]
        if isinstance(deepest, dict) and str(deepest.get("type") or "").lower() in PRECISE_TYPES:
            return "high"
    return "medium"


def parse_response(body: Any) -> ParseResult:
    """Pathao's reply → ParseResult. A failed parse answers 200 with no `data`
    key at all, so its absence is the normal "no match", not an error."""
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict):
        # A genuine "could not sort this" keeps Pathao's message as its raw,
        # so it can be told apart from a call that never got an answer
        # (raw=None) — the order records the first and retries the second.
        message = body.get("message") if isinstance(body, dict) else None
        return ParseResult(matched=False, raw={"message": message} if message else {})
    # district_id is the same number create-order calls recipient_city.
    city_id = _int(data.get("district_id"))
    zone_id = _int(data.get("zone_id"))
    if city_id is None:
        return ParseResult(matched=False, raw=data)
    return ParseResult(
        matched=True,
        city_id=city_id,
        city_name=_str(data.get("district_name")),
        zone_id=zone_id,
        zone_name=_str(data.get("zone_name")),
        area_id=_int(data.get("area_id")) if zone_id is not None else None,
        area_name=_str(data.get("area_name")) if zone_id is not None else None,
        confidence=confidence_of(data),
        raw=data,
    )


# --- Circuit breaker ------------------------------------------------------------


class _Breaker:
    def __init__(self) -> None:
        self.failures = 0
        self.open_until = 0.0

    @property
    def is_open(self) -> bool:
        return self.open_until > time.monotonic()

    def succeeded(self) -> None:
        self.failures = 0
        self.open_until = 0.0

    def failed(self) -> None:
        self.failures += 1
        if self.failures >= BREAKER_FAILURES:
            self.open_until = time.monotonic() + BREAKER_COOLDOWN_SECONDS
            self.failures = 0
            log.warning(
                "Pathao address parser: %d failures in a row, pausing for %ds",
                BREAKER_FAILURES,
                BREAKER_COOLDOWN_SECONDS,
            )

    def reset(self) -> None:
        self.succeeded()


breaker = _Breaker()


# --- HTTP -----------------------------------------------------------------------


def _post_sync(address: str, token: str) -> tuple[int, Any]:
    res = requests.post(
        settings.pathao_parser_url,
        json={"address": address},
        headers={
            "Content-Type": "application/json; charset=UTF-8",
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
        },
        timeout=TIMEOUT_SECONDS,
    )
    return res.status_code, pathao._json_or_text(res)


async def _ask_pathao(cfg: PathaoConfig, store_id: int, address: str) -> ParseResult:
    """One call with the store's courier-API token, re-issued once on a 401.
    Raises on transport and HTTP failures; the caller turns those into
    matched=False and counts them on the breaker."""
    token = await pathao.get_access_token(cfg, store_id)
    for attempt in (1, 2):
        status, body = await asyncio.to_thread(_post_sync, address, token)
        if status == 200:
            return parse_response(body)
        if status == 401 and attempt == 1:
            token = await pathao.get_access_token(cfg, store_id, force=True)
            continue
        raise pathao.PathaoError(f"Address parser answered {status}", status=status)
    raise pathao.PathaoError("Address parser failed")  # unreachable


# --- Cache ------------------------------------------------------------------------


async def cached(session: AsyncSession, address: str) -> ParseResult | None:
    """The stored answer for this address, if fresh. No network."""
    row = await session.get(PathaoAddressParse, cache_key(address))
    if row is None:
        return None
    if row.created_at < datetime.now(timezone.utc) - CACHE_TTL:
        return None
    return ParseResult.from_json(row.result)


async def _store(session: AsyncSession, address: str, result: ParseResult) -> None:
    key = cache_key(address)
    row = await session.get(PathaoAddressParse, key)
    if row is None:
        session.add(PathaoAddressParse(address_key=key, result=result.as_json()))
    else:
        row.result = result.as_json()
        row.created_at = datetime.now(timezone.utc)
    await session.commit()


# --- Public ---------------------------------------------------------------------------


async def parse(
    session: AsyncSession, cfg: PathaoConfig, store_id: int, address: str
) -> ParseResult:
    """Pathao's best guess at where this address is. Never raises: any
    trouble answers matched=False and staff pick the location by hand.

    Only a positive answer is cached — a miss may be a hiccup on Pathao's
    side, and asking again costs one call. The session is committed when a
    cache row is written; call this outside a transaction that must stay
    open."""
    text = " ".join(address.split())[:MAX_CHARS]
    if len(text) < MIN_CHARS or not enabled() or not cfg.enabled:
        return NO_MATCH
    hit = await cached(session, text)
    if hit is not None:
        return hit
    if breaker.is_open:
        return NO_MATCH
    try:
        result = await _ask_pathao(cfg, store_id, text)
    except (pathao.PathaoError, requests.RequestException) as exc:
        breaker.failed()
        log.warning("Pathao address parser: %s", exc)
        return NO_MATCH
    except Exception:  # noqa: BLE001 - a convenience must never break the form
        breaker.failed()
        log.exception("Pathao address parser: unexpected failure")
        return NO_MATCH
    breaker.succeeded()
    if result.matched:
        await _store(session, text, result)
    return result


def record_on_order(
    order: Order,
    result: ParseResult | None,
    *,
    selected: str,
) -> None:
    """Keep the parser's full answer for the order's address next to the ids
    that ended up on the order. `selected` says whose ids they are: "parser"
    when the answer was taken as is, "manual" when staff picked."""
    order.pathao_address_parse = {
        **(result.as_json() if result is not None else NO_MATCH.as_json()),
        "selected": selected,
        "address": " ".join((order.address or "").split())[:MAX_CHARS],
        "parsed_at": datetime.now(timezone.utc).isoformat(),
    }


def apply_to_order(order: Order, result: ParseResult) -> bool:
    """Put a parser answer's ids on the order. Returns whether it matched."""
    if not result.matched:
        record_on_order(order, result, selected="parser")
        return False
    order.pathao_city_id = result.city_id
    order.pathao_zone_id = result.zone_id
    order.pathao_area_id = result.area_id
    record_on_order(order, result, selected="parser")
    return True


__all__ = [
    "MIN_CHARS",
    "NO_MATCH",
    "ParseResult",
    "apply_to_order",
    "breaker",
    "cache_key",
    "cached",
    "confidence_of",
    "enabled",
    "normalise",
    "parse",
    "parse_response",
    "record_on_order",
]
