import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from api.config import settings
from api.models import OrderSource, OrderStatus, UserRole, UserStatus
from api.phone import bd_mobile
from api.services.pathao import tracking_url

PHONE_RULE = "Phone must be an 11-digit Bangladeshi mobile number (01XXXXXXXXX)"


def _valid_bd_mobile(value: str) -> str:
    normalised = bd_mobile(value)
    if normalised is None:
        raise ValueError(PHONE_RULE)
    return normalised


class OrderCreate(BaseModel):
    customer_name: str = Field(min_length=1, max_length=120)
    # Stored in the courier's 01XXXXXXXXX form; anything else is a 422.
    phone: str = Field(min_length=6, max_length=32)
    address: str = Field(min_length=4, max_length=1000)
    quantity: int = Field(default=1, ge=1, le=50)
    # Which variant the customer picked (the size, on the landing page). Only
    # the id travels: the name and price are read from that row on the server,
    # so the browser can never set what an order costs. Absent from the old
    # storefront, which sells the default variant and nothing else.
    variant_id: int | None = None
    # Anything the customer wanted to tell us. Lands in the order's comment,
    # where staff already read and write notes.
    note: str = Field(default="", max_length=500)
    # The browser's draft key, when this visit had already autosaved a partial
    # form. It promotes that Incomplete row instead of creating a second one.
    draft_key: str | None = Field(default=None, min_length=8, max_length=64)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        return _valid_bd_mobile(value)


class OrderDraft(BaseModel):
    """A partially filled storefront form, autosaved before it was submitted."""

    draft_key: str = Field(min_length=8, max_length=64)
    customer_name: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=32)
    address: str = Field(default="", max_length=1000)


class OrderDraftOut(BaseModel):
    # Whether the draft was stored. Not stored when there is no usable phone
    # yet, or when this customer already has a real order.
    saved: bool


class TagCreate(BaseModel):
    label: str = Field(min_length=1, max_length=50)


class OrderUpdate(BaseModel):
    status: OrderStatus | None = None
    printed: bool | None = None
    courier: bool | None = None
    comment: str | None = Field(default=None, max_length=2000)
    customer_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, min_length=6, max_length=32)
    address: str | None = Field(default=None, min_length=4, max_length=1000)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        return None if value is None else _valid_bd_mobile(value)


class OrderTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    created_by_name: str | None
    created_by_nickname: str | None = None
    created_at: datetime


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int | None = None
    variant_id: int | None = None
    product_name: str
    unit_price: int
    quantity: int

    @computed_field
    @property
    def line_total(self) -> int:
        return self.unit_price * self.quantity


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_name: str
    phone: str
    address: str
    product_name: str
    quantity: int
    unit_price: int
    total_amount: int
    status: OrderStatus
    comment: str
    created_at: datetime
    updated_at: datetime
    source: OrderSource = OrderSource.website
    printed: bool = False
    courier: bool = False
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    assigned_to_nickname: str | None = None
    assigned_at: datetime | None = None
    # Who last moved the status — the worker credited on each list.
    handled_by_name: str | None = None
    handled_by_nickname: str | None = None
    tags: list[OrderTagOut] = []
    items: list[OrderItemOut] = []
    pathao_consignment_id: str | None = None
    pathao_status: str | None = None
    pathao_delivery_fee: int | None = None
    pathao_sent_at: datetime | None = None
    # Read to derive auto_captured; never serialised — it is the browser's key.
    draft_key: str | None = Field(default=None, exclude=True)

    @computed_field
    @property
    def pathao_tracking_url(self) -> str | None:
        if not self.pathao_consignment_id:
            return None
        return tracking_url(self.pathao_consignment_id, self.phone)

    # From the model: "<store prefix>-<id>".
    order_no: str

    @computed_field
    @property
    def claim_active(self) -> bool:
        """Someone has this order open right now. Decided here, against the
        server clock, so a staff laptop with the wrong time can't misjudge it."""
        if self.assigned_to is None or self.assigned_at is None:
            return False
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.claim_ttl_minutes)
        return self.assigned_at >= cutoff

    @computed_field
    @property
    def auto_captured(self) -> bool:
        """An abandoned storefront form, captured without anyone submitting it."""
        return self.draft_key is not None and self.status == OrderStatus.incomplete


class ClaimOut(BaseModel):
    """One held order, for the fast claims poll."""

    id: int
    assigned_to: int
    assigned_to_name: str | None
    assigned_to_nickname: str | None
    assigned_at: datetime


class ClaimsOut(BaseModel):
    ttl_seconds: int
    claims: list[ClaimOut]


class OrderListOut(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    pages: int


class OrderCountsOut(BaseModel):
    """Rows per status, zero-filled, for the sidebar counters."""

    counts: dict[str, int]


class BulkOrderUpdate(BaseModel):
    """One change applied to many orders: a status move or a fulfilment flag."""

    order_ids: list[int] = Field(min_length=1, max_length=200)
    status: OrderStatus | None = None
    printed: bool | None = None
    courier: bool | None = None


class BulkSkipped(BaseModel):
    order_id: int
    order_no: str
    reason: str


class BulkOrderResult(BaseModel):
    updated: list[OrderOut]
    skipped: list[BulkSkipped]


# Pathao is called one order at a time (only the per-order endpoint hands back
# a consignment id), so a batch's wall time grows with its length. Twenty keeps
# a request well inside Cloudflare's 100s proxy timeout; the admin splits a
# larger selection and sends the batches back to back.
PATHAO_BATCH_LIMIT = 20


class PathaoSendIn(BaseModel):
    order_ids: list[int] = Field(min_length=1, max_length=PATHAO_BATCH_LIMIT)


class PathaoFailure(BaseModel):
    order_id: int
    order_no: str
    error: str


class PathaoSendOut(BaseModel):
    orders: list[OrderOut]
    failed: list[PathaoFailure]


class PathaoStatusOut(BaseModel):
    enabled: bool
    sandbox: bool
    base_url: str
    store_id: int
    unit_weight_kg: float
    stores: list[dict] = []
    error: str | None = None


class DashboardTotals(BaseModel):
    """A month's headline figures."""

    # Landed from the site and from staff.
    orders: int
    # Won from anywhere: the site, staff, and recovered leads.
    confirmed: int
    # Reported delivered by the courier.
    delivered: int


class DashboardPeriod(BaseModel):
    """The chosen days' orders by where they stand now, and the leads apart."""

    landed: int
    # Still exactly where they arrived: nobody has moved them yet.
    processing: int
    # From the site, from staff, and leads that were recovered.
    confirmed: int
    no_response: int
    cancelled: int
    # Taken by staff over a call, WhatsApp or Messenger.
    manual: int
    leads: int
    leads_processing: int
    leads_confirmed: int


class Performer(BaseModel):
    user_id: int
    name: str
    nickname: str | None = None
    confirmed: int
    # Every status change they made, confirmations included.
    handled: int


class DashboardOut(BaseModel):
    date_from: date
    date_to: date
    # "2026-09": the month the top row describes — the one date_to falls in.
    month: str
    this_month: DashboardTotals
    last_month: DashboardTotals
    period: DashboardPeriod
    performers: list[Performer]


class ActivityOut(BaseModel):
    """One thing a staff member did to an order, for the performer history."""

    id: int
    order_id: int
    order_no: str
    customer_name: str
    event_type: str
    old_status: str | None = None
    new_status: str | None = None
    note: str | None = None
    created_at: datetime


class OrderStatsOut(BaseModel):
    total: int
    in_progress: int
    confirmed: int
    cancelled: int
    revenue: int
    incomplete: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    nickname: str | None = None
    picture_url: str | None
    role: UserRole
    status: UserStatus
    created_at: datetime
    last_active_at: datetime | None


class UserWithActivityOut(UserOut):
    memberships: list["MembershipOut"] = Field(default_factory=list)
    orders_confirmed: int = 0
    orders_shipped: int = 0
    # Super admin by server configuration (SUPER_ADMIN_EMAILS): the role is
    # re-applied on every request, so it cannot be taken away from here.
    pinned: bool = False


class UserUpdate(BaseModel):
    status: UserStatus | None = None
    role: UserRole | None = None
    # "" clears the nickname and falls back to the person's full name.
    nickname: str | None = Field(default=None, max_length=40)


class VariantOut(BaseModel):
    """One version of a product, as the admin sees it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    label: str
    default_quantity: int
    unit_price: int
    sku: str
    is_default: bool
    image_path: str | None = Field(default=None, exclude=True)

    @computed_field
    @property
    def image_url(self) -> str | None:
        return f"/media/{self.image_path}" if self.image_path else None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    variants: list[VariantOut] = []


class VariantSave(BaseModel):
    """One version as the editor sends it back. With an id it updates that
    row; without one it is new. Rows the product had that are missing from
    the list are deleted."""

    id: int | None = None
    label: str = Field(default="", max_length=120)
    default_quantity: int = Field(default=1, ge=1, le=99)
    unit_price: int = Field(ge=1)
    sku: str = Field(min_length=1, max_length=64)
    is_default: bool = False


class ProductSave(BaseModel):
    """The whole product as the editor holds it, saved in one go: the name,
    the versions and the description. A product must have at least one version
    or there is nothing to sell, and exactly one of them is the default."""

    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=20000)
    variants: list[VariantSave] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _one_default(self) -> "ProductSave":
        defaults = [v for v in self.variants if v.is_default]
        if len(defaults) > 1:
            raise ValueError("Only one version can be the default")
        if not defaults:
            # The editor always marks one; a client that did not gets the
            # first, which is what a customer would see first anyway.
            self.variants[0].is_default = True
        return self


class ProductSaveOut(BaseModel):
    product: ProductOut
    # The saved versions' ids in the order they were sent, so the browser can
    # attach a picture to a row that did not exist before this save.
    variant_ids: list[int]


class StorefrontProductOut(BaseModel):
    """What the old storefront sells: the active product's default variant,
    in the one-product shape that page was written against.

    Deliberately narrower than ProductOut: the storefront has no use for row
    ids, timestamps or the active flag, and this endpoint needs no auth.
    """

    title: str
    subtitle: str = ""
    default_quantity: int
    unit_price: int
    sku: str
    image_path: str | None = Field(default=None, exclude=True)

    @computed_field
    @property
    def image_url(self) -> str | None:
        return f"/media/{self.image_path}" if self.image_path else None


class StorefrontVariantOut(BaseModel):
    """One entry in the landing page's size picker."""

    id: int
    # The product and the size together, which is what the heading, the
    # picker and the order all show.
    title: str
    label: str
    default_quantity: int
    unit_price: int
    sku: str
    is_default: bool = False
    image_path: str | None = Field(default=None, exclude=True)

    @computed_field
    @property
    def image_url(self) -> str | None:
        return f"/media/{self.image_path}" if self.image_path else None


class StorefrontListingOut(BaseModel):
    """The landing page's whole offer: the active product, its description and
    the variants to choose between, the default first."""

    title: str
    description: str
    variants: list[StorefrontVariantOut]


class ManualOrderItem(BaseModel):
    """One line of a manually taken order. Only which variant and how many —
    the name and price are read from the catalogue server-side, never sent by
    the browser."""

    variant_id: int
    quantity: int = Field(default=1, ge=1, le=99)


class ManualOrderCreate(BaseModel):
    """An order typed in by staff, over the phone or in person.

    Unlike the storefront's OrderCreate this carries a cart, skips the
    per-number cooldown (staff are talking to the customer, so a repeat is
    deliberate) and chooses which list the order lands in.
    """

    customer_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=6, max_length=32)
    address: str = Field(min_length=4, max_length=1000)
    items: list[ManualOrderItem] = Field(min_length=1, max_length=50)
    comment: str = Field(default="", max_length=2000)
    # "approved" drops the order straight into Confirmed; "manual" leaves it on
    # the Web Order List for someone to call through.
    approved: bool = True

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        return _valid_bd_mobile(value)



class PhoneLookupOut(BaseModel):
    # Normalised to 01XXXXXXXXX, so the caller can see what was actually matched.
    phone: str
    # Orders this customer actually placed. Full OrderOut rather than a
    # summary: staff open the whole order from these rows, and a second
    # round-trip per row to fetch the rest would be wasted.
    orders: list[OrderOut] = []
    # Abandoned storefront forms: this number typed a form and never submitted
    # it. Kept apart from real orders because it means something different on a
    # call — nothing was ordered, so it is a lead to close, not a delivery to
    # explain.
    incomplete: list[OrderOut] = []


# --- Meta tracking -----------------------------------------------------------

# The browser Pixel events that get a server-side twin through POST /api/track.
# Purchase is not here: its server copy is sent by the order endpoint itself.
TRACK_EVENT_NAMES = ("PageView", "ViewContent", "AddToCart", "InitiateCheckout")


class TrackCustomData(BaseModel):
    """
    The parameters the browser Pixel already sends with these events, and
    nothing else — the schema forbids extra keys, so no PII can ride along.
    """

    model_config = ConfigDict(extra="forbid")

    content_ids: list[str] | None = Field(default=None, max_length=50)
    content_type: str | None = Field(default=None, max_length=32)
    value: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    num_items: int | None = Field(default=None, ge=0)

    @field_validator("content_ids")
    @classmethod
    def _ids(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and any(len(item) > 64 for item in value):
            raise ValueError("content id too long")
        return value


class TrackEventIn(BaseModel):
    """
    A browser Pixel event, reported so the API can send the same event to the
    Conversions API with the same id. Meta deduplicates the pair; the server
    copy survives an ad blocker or a tab closed before the SDK loaded.
    """

    model_config = ConfigDict(extra="forbid")

    event_name: Literal["PageView", "ViewContent", "AddToCart", "InitiateCheckout"]
    # The browser's eventID. UUID only: the browser mints it, the server never
    # keys anything on it, and an arbitrary string would be a channel for junk.
    event_id: UUID
    event_source_url: str | None = Field(default=None, max_length=2048)
    custom_data: TrackCustomData | None = None
    # The Pixel cookies as the page read them. Normally redundant — the
    # browser sends them as request cookies and the web container's proxy
    # passes the Cookie header through — but a proxy that strips cookies would
    # otherwise silently cost every server event its browser match keys. The
    # API prefers the cookie header and falls back to these.
    fbp: str | None = Field(default=None, max_length=64, pattern=r"^fb\.\d\.\d+\.\d+$")
    fbc: str | None = Field(default=None, max_length=512, pattern=r"^fb\.\d\.\d+\.[\w.-]+$")


class CapiResendIn(BaseModel):
    """Which parked Conversions API events to resend; empty = the oldest 100."""

    ids: list[int] | None = Field(default=None, max_length=100)


class CapiFailedEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    attempts: int
    last_error: str
    payload: dict

    @computed_field
    @property
    def event_name(self) -> str:
        return str(self.payload.get("event_name", ""))

    @computed_field
    @property
    def event_id(self) -> str:
        return str(self.payload.get("event_id", ""))


# --- stores ------------------------------------------------------------------


class StoreConfigOut(BaseModel):
    """The store a storefront request resolved to. No secrets: this is read by
    the page renderer and could be read by anyone on the store's hostname."""

    id: int
    slug: str
    name: str
    template: str
    currency: str
    theme: dict
    content: dict[str, str]
    host: str | None
    domains: list[str]
    # Public by nature (it is in the page source); the browser pixel needs it.
    meta_pixel_id: str = ""
    order_prefix: str = "NB"


class StoreDirectoryEntry(BaseModel):
    slug: str
    name: str
    domains: list[str]


class StoreAccessOut(BaseModel):
    """A store the signed-in user may open, and as what."""

    store_id: int
    slug: str
    name: str
    role: str


class StoreOut(BaseModel):
    """A store as the platform admin sees it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    template: str
    currency: str
    order_prefix: str
    theme: dict
    is_active: bool
    domains: list[str]
    primary_domain: str | None
    created_at: datetime
    updated_at: datetime


_SLUG_RE = r"^[a-z0-9][a-z0-9-]{0,39}$"
_HOST_RE = r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$"


_PREFIX_RE = r"^[A-Z][A-Z0-9]{0,7}$"


class StoreCreate(BaseModel):
    slug: str = Field(pattern=_SLUG_RE)
    name: str = Field(min_length=1, max_length=120)
    # "NB" in "NB-1042". Uppercase letters and digits, unique across stores.
    order_prefix: str = Field(min_length=1, max_length=8)
    template: str = Field(default="classic", max_length=40)
    currency: str = Field(default="BDT", min_length=3, max_length=3)
    theme: dict[str, str] = Field(default_factory=dict)
    # The first is the primary domain. Normalised (lowercased, port dropped)
    # before validation and storage.
    domains: list[str] = Field(default_factory=list, max_length=20)
    is_active: bool = True

    @field_validator("domains")
    @classmethod
    def _domains(cls, values: list[str]) -> list[str]:
        from api.stores import normalise_host

        out: list[str] = []
        for raw in values:
            host = normalise_host(raw)
            if host is None:
                continue
            if not re.match(_HOST_RE, host) and host != "localhost":
                raise ValueError(f"Not a hostname: {raw!r}")
            if host not in out:
                out.append(host)
        return out

    @field_validator("currency")
    @classmethod
    def _currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("order_prefix")
    @classmethod
    def _prefix(cls, value: str) -> str:
        value = value.strip().upper()
        if not re.match(_PREFIX_RE, value):
            raise ValueError("Prefix: 1-8 letters or digits, starting with a letter")
        return value

    @field_validator("theme")
    @classmethod
    def _theme(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 30:
            raise ValueError("Too many theme keys")
        for k, v in value.items():
            if len(k) > 40 or len(v) > 200:
                raise ValueError("Theme entry too long")
        return value


class StoreUpdate(BaseModel):
    """Everything but the slug, which is the store's stable handle."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    order_prefix: str | None = Field(default=None, min_length=1, max_length=8)
    template: str | None = Field(default=None, max_length=40)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    theme: dict[str, str] | None = None
    domains: list[str] | None = Field(default=None, max_length=20)
    is_active: bool | None = None

    _domains = field_validator("domains")(StoreCreate._domains.__func__)  # type: ignore[attr-defined]
    _prefix = field_validator("order_prefix")(StoreCreate._prefix.__func__)  # type: ignore[attr-defined]
    _theme = field_validator("theme")(StoreCreate._theme.__func__)  # type: ignore[attr-defined]


class MembershipIn(BaseModel):
    store_id: int
    role: Literal["owner", "manager", "staff"]


class MembershipOut(BaseModel):
    store_id: int
    slug: str
    name: str
    role: str


class MembershipsUpdate(BaseModel):
    """The user's complete membership list; stores left out are removed."""

    memberships: list[MembershipIn] = Field(max_length=200)

    @model_validator(mode="after")
    def _unique(self) -> "MembershipsUpdate":
        ids = [m.store_id for m in self.memberships]
        if len(ids) != len(set(ids)):
            raise ValueError("A store is listed twice")
        return self
