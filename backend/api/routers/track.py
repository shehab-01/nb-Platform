"""
POST /api/track — server-side twins of the browser Pixel events.

The storefront fires PageView, ViewContent, AddToCart and InitiateCheckout in
the browser with a fresh UUID as eventID, and posts the same id here. This
sends the event to the Conversions API with that id, so Meta deduplicates the
pair and still counts the event when the browser copy never made it (ad
blocker, tab closed before fbevents.js loaded, SDK blocked by the network).

Public and unauthenticated, so it is deliberately narrow: a whitelist of event
names, a UUID id, and only the custom_data keys the Pixel itself sends (the
schema rejects anything else with 422). No PII is accepted in the body — the
match keys (IP, user agent, _fbp/_fbc cookies) are taken from the request.
"""
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from api import stores, visits
from api.config import settings
from api.db import get_session
from api.ratelimit import RateLimiter
from api.schemas import TrackEventIn
from api.services import meta_capi

router = APIRouter(prefix="/track", tags=["Tracking"])

# Per IP per minute. A page load fires a handful of events; sixty is room for
# a whole visit through a CGNAT address without letting a script hammer Meta
# through us.
track_limiter = RateLimiter("track", settings.rate_limit_track, 60)


def _is_admin_url(url: str | None) -> bool:
    if not url:
        return False
    try:
        path = urlparse(url).path
        return path.startswith("/admin") or path.startswith("/preview")
    except ValueError:
        return False


@router.post(
    "",
    status_code=204,
    response_class=Response,
    dependencies=[Depends(track_limiter)],
)
async def track_event(
    payload: TrackEventIn,
    request: Request,
    store: stores.StoreConfig = Depends(stores.current_store),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Acknowledge at once; the Conversions API call runs as its own task
    with the store's pixel and token. The store is the one the hostname
    resolves to (404 otherwise, like every storefront call)."""
    # Staff traffic never reaches Meta: the browser already skips /admin, and
    # this guards the same line on the server for anything that slips through.
    if _is_admin_url(payload.event_source_url) or _is_admin_url(
        request.headers.get("referer")
    ):
        return Response(status_code=204)
    # A page view is a visit for the System page's visitor count, whether or
    # not Meta is configured.
    if payload.event_name == "PageView":
        visits.record(
            request,
            store_id=store.id,
            source_url=payload.event_source_url,
            fbp_fallback=payload.fbp,
        )
    integrations = await stores.load_integrations(session, store.id)
    if integrations is None or not integrations.meta.enabled:
        return Response(status_code=204)

    ctx = meta_capi.client_context(
        request,
        source_url=payload.event_source_url,
        fbp_fallback=payload.fbp,
        fbc_fallback=payload.fbc,
    )
    event = meta_capi.build_event(
        event_name=payload.event_name,
        event_id=str(payload.event_id),
        ctx=ctx,
        custom_data=(
            payload.custom_data.model_dump(exclude_none=True)
            if payload.custom_data
            else None
        ),
    )
    meta_capi.dispatch(event, integrations.meta, store.id)
    return Response(status_code=204)
