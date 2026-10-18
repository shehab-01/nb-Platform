"""What the couriers' status words mean, for every courier at once.

An order is booked with at most one courier (orders.courier_provider) and
carries that courier's own status word in orders.courier_status: Pathao's as
Pathao spells it ("Delivered", "Partial_Delivery", "Return"), Carrybee's as
its event slug ("delivered", "partial-delivery", "returned-to-merchant").
The two vocabularies never collide, so the dashboards and the staff pages
judge every parcel with one set of lower-cased words and need not ask whose
parcel it is.
"""
from __future__ import annotations

from urllib.parse import quote

from api.config import settings

PATHAO = "pathao"
CARRYBEE = "carrybee"
COURIERS = (PATHAO, CARRYBEE)
LABELS = {PATHAO: "Pathao", CARRYBEE: "Carrybee"}
# An order not booked with any courier yet, where a courier name would go
# (the dashboard's split and the order lists' Courier filter).
NOT_SENT = "none"

# Where a parcel's story ends, per courier: the background syncs stop asking
# about a parcel once it says one of these (compared in lower case).
PATHAO_SETTLED = ("delivered", "partial_delivery", "return", "paid_return", "cancelled")
CARRYBEE_SETTLED = (
    "delivered",
    "partial-delivery",
    "paid-return",
    "returned-to-merchant",
    "pickup-cancelled",
    "exchange",
)

# Counted as delivered. Only a full delivery, as before Carrybee existed.
DELIVERED = ("delivered",)
# Counted as returned: on its way back or back with us.
RETURNED = (
    "return",
    "paid_return",
    "returned",
    "paid-return",
    "returned-at-sorting",
    "returned-in-transit",
    "returned-to-merchant",
)
# No longer in transit, either way: finished, or turned round.
FINISHED = tuple(dict.fromkeys((*PATHAO_SETTLED, *CARRYBEE_SETTLED, *RETURNED)))

# The audit-trail event types that record a status the courier reported.
STATUS_EVENTS = ("pathao_status", "carrybee_status")


def is_settled(provider: str | None, status: str | None) -> bool:
    words = CARRYBEE_SETTLED if provider == CARRYBEE else PATHAO_SETTLED
    return (status or "").lower() in words


def tracking_url(provider: str | None, consignment_id: str | None, phone: str) -> str | None:
    """Where staff (and customers) can follow the parcel, if the courier has
    a public page; None when it has none configured."""
    if not consignment_id:
        return None
    if provider == CARRYBEE:
        template = settings.carrybee_tracking_url
        if not template:
            return None
        return template.replace("{consignment_id}", quote(consignment_id, safe=""))
    # Pathao, and every order booked before courier_provider existed.
    from api.services.pathao import tracking_url as pathao_tracking_url

    return pathao_tracking_url(consignment_id, phone)
