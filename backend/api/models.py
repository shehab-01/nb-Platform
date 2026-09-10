import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class OrderStatus(str, enum.Enum):
    processing = "processing"
    incomplete = "incomplete"
    good_but_no_response = "good_but_no_response"
    no_response = "no_response"
    advance_payment = "advance_payment"
    on_hold = "on_hold"
    confirmed = "confirmed"
    shipped = "shipped"
    cancelled = "cancelled"
    # The archive: a finished order, moved off the Shipping list by hand so
    # that list only ever shows parcels still in flight.
    history = "history"


class OrderSource(str, enum.Enum):
    """How the order entered the system."""

    website = "website"
    # Started life as an abandoned storefront form and was worked from the
    # Incomplete list, so confirmations here measure recovered leads.
    incomplete = "incomplete"
    # Typed in by staff from a call, a WhatsApp or a Messenger chat.
    manual = "manual"


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    staff = "staff"


class UserStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    suspended = "suspended"


def _enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        values_callable=lambda e: [member.value for member in e],
    )


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # The store this order was placed with; every list and lookup filters on
    # it first. Order numbers are "<store prefix>-<id>" with one global id
    # sequence, so a number is unique across the platform.
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="RESTRICT"))
    customer_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32))
    address: Mapped[str] = mapped_column(Text)
    product_name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price: Mapped[int] = mapped_column(Integer)
    total_amount: Mapped[int] = mapped_column(Integer)
    # Plain string in the DB (validated by the API layer) so the status
    # vocabulary can evolve without enum migrations.
    status: Mapped[str] = mapped_column(
        String(30), default=OrderStatus.processing.value, index=True
    )
    comment: Mapped[str] = mapped_column(Text, default="")
    # Set when the row came from an abandoned storefront form rather than a
    # submitted order: the browser's per-visit key, so repeated autosaves keep
    # updating one row and a later submit promotes that same row.
    draft_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    # Normalised phone (see api.phone) — the identity used to make sure one
    # customer never sits in Incomplete and in the live order lists at once.
    phone_key: Mapped[str | None] = mapped_column(String(20), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    source: Mapped[str] = mapped_column(
        String(20), default=OrderSource.website.value, index=True
    )
    # Whether the invoice has been printed and the parcel handed to a courier.
    # Set by hand for now; the automation lands later.
    printed: Mapped[bool] = mapped_column(Boolean, default=False)
    courier: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set once the parcel is booked with Pathao (see api.services.pathao).
    # The consignment id is Pathao's tracking number; status and fee are
    # whatever Pathao last told us.
    pathao_consignment_id: Mapped[str | None] = mapped_column(String(40), index=True)
    pathao_status: Mapped[str | None] = mapped_column(String(60))
    pathao_delivery_fee: Mapped[int | None] = mapped_column(Integer)
    pathao_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Which worker has claimed this order (is calling the customer).
    assigned_to: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Who last moved this order's status. On a confirmed order that is whoever
    # confirmed it; on any other list, whoever put it there.
    handled_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    # The FraudBD check run for this order's phone (see api.services.fraudbd);
    # null until the check has run, or when the store has no FraudBD key.
    fraud_check_id: Mapped[int | None] = mapped_column(
        ForeignKey("fraud_checks.id", ondelete="SET NULL")
    )

    store: Mapped["Store"] = relationship(lazy="joined")
    fraud_check: Mapped["FraudCheck | None"] = relationship(lazy="joined")
    assignee: Mapped["User | None"] = relationship(
        lazy="joined", foreign_keys=[assigned_to]
    )
    handler: Mapped["User | None"] = relationship(
        lazy="joined", foreign_keys=[handled_by]
    )
    tags: Mapped[list["OrderTag"]] = relationship(
        lazy="selectin", order_by="OrderTag.id", cascade="all, delete-orphan"
    )
    items: Mapped[list["OrderItem"]] = relationship(
        lazy="selectin", order_by="OrderItem.id", cascade="all, delete-orphan"
    )

    @property
    def order_no(self) -> str:
        """"<prefix>-<id>", the number customers, stickers and Meta see."""
        prefix = "NB"
        if "store" not in sa_inspect(self).unloaded and self.store is not None:
            prefix = self.store.order_prefix
        return f"{prefix}-{self.id}"

    @property
    def assigned_to_name(self) -> str | None:
        # Guard: a freshly-inserted instance hasn't loaded the relationship,
        # and touching it lazily outside the async context would blow up.
        if "assignee" in sa_inspect(self).unloaded:
            return None
        return self.assignee.name if self.assignee else None

    @property
    def handled_by_name(self) -> str | None:
        if "handler" in sa_inspect(self).unloaded:
            return None
        return self.handler.name if self.handler else None

    @property
    def assigned_to_nickname(self) -> str | None:
        if "assignee" in sa_inspect(self).unloaded:
            return None
        return self.assignee.nickname if self.assignee else None

    @property
    def assigned_to_display(self) -> str | None:
        if "assignee" in sa_inspect(self).unloaded:
            return None
        return self.assignee.display_name if self.assignee else None

    @property
    def handled_by_nickname(self) -> str | None:
        if "handler" in sa_inspect(self).unloaded:
            return None
        return self.handler.nickname if self.handler else None

    __table_args__ = (
        # The admin list query: WHERE store_id = ? AND status IN (...) ORDER BY created_at
        Index("ix_orders_store_status_created_at", "store_id", "status", "created_at"),
        Index("ix_orders_store_phone_key", "store_id", "phone_key"),
        Index("ix_orders_store_created_at", "store_id", "created_at"),
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    # A short working name a super admin gives this person. Google supplies the
    # legal name, which is long and often shares an honorific with half the
    # team, so the nickname is what the admin UI shows.
    nickname: Mapped[str | None] = mapped_column(String(40))
    picture_url: Mapped[str | None] = mapped_column(String(500))
    role: Mapped[UserRole] = mapped_column(
        _enum(UserRole, "user_role"), default=UserRole.staff
    )
    status: Mapped[UserStatus] = mapped_column(
        _enum(UserStatus, "user_status"), default=UserStatus.pending, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def display_name(self) -> str:
        """What this person is called in the UI."""
        return self.nickname or self.name


class OrderTag(Base):
    __tablename__ = "order_tags"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    label: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    creator: Mapped["User | None"] = relationship(lazy="joined")

    @property
    def created_by_name(self) -> str | None:
        if "creator" in sa_inspect(self).unloaded:
            return None
        return self.creator.name if self.creator else None

    @property
    def created_by_nickname(self) -> str | None:
        if "creator" in sa_inspect(self).unloaded:
            return None
        return self.creator.nickname if self.creator else None


class OrderEvent(Base):
    """Append-only audit trail; per-worker activity counts aggregate from here."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Copied from the order, so per-store dashboards aggregate without a join.
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="RESTRICT"))
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    event_type: Mapped[str] = mapped_column(String(40))
    old_status: Mapped[str | None] = mapped_column(String(30))
    new_status: Mapped[str | None] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    __table_args__ = (
        Index("ix_order_events_actor_type", "actor_id", "event_type"),
        Index("ix_order_events_store_actor_type", "store_id", "actor_id", "event_type"),
        Index("ix_order_events_store_created_at", "store_id", "created_at"),
    )


class TrafficMinute(Base):
    """
    Request counts per minute, one row per worker process. Each worker keeps
    its own counters in memory and flushes deltas every few seconds; readers
    sum across workers, so the numbers are whole-service totals that survive
    restarts. See api.monitoring.
    """

    __tablename__ = "traffic_minutes"

    minute: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    worker: Mapped[str] = mapped_column(String(64), primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0)
    # 429s from the rate limiter and 409s from the order cooldown are the two
    # signals worth watching on their own; the rest fold into 4xx / 5xx.
    throttled: Mapped[int] = mapped_column(Integer, default=0)
    cooldown: Mapped[int] = mapped_column(Integer, default=0)
    client_errors: Mapped[int] = mapped_column(Integer, default=0)
    server_errors: Mapped[int] = mapped_column(Integer, default=0)
    # Summed, so an average is latency_ms / requests.
    latency_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class IntegrationToken(Base):
    """
    OAuth tokens for a third-party API (one row per provider). Pathao's access
    token lives for days, so it is issued once and shared by every worker
    process rather than fetched per request.
    """

    __tablename__ = "integration_tokens"

    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True
    )
    provider: Mapped[str] = mapped_column(String(40), primary_key=True)
    access_token: Mapped[str] = mapped_column(Text)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MetaCapiFailedEvent(Base):
    """
    A Conversions API event Meta never accepted: every retry failed, or the
    request was rejected outright. The full payload is kept so it can be
    resent from Admin → System once the cause (token, network, Meta outage)
    is fixed. See api.services.meta_capi.
    """

    __tablename__ = "meta_capi_failed_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # Whose pixel and token the resend must use.
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Product(Base):
    """
    A sellable product: the group the landing page is about. What is actually
    priced and put in a parcel is one of its variants (a size, say); the product
    carries what they share — the name and the description.

    The storefront sells exactly one product at a time: the row with is_active
    set is what the landing page shows, and its variants are the sizes offered.

    Orders keep their own product_name / unit_price / total_amount columns, so
    editing or deleting a product never rewrites what a past order recorded.
    """

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # The catalogue is per store; every read filters on this first.
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    # Shown under the fold on the landing page. Plain text for now; the rich
    # text editor will store HTML here later.
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # The default first, then dearest to cheapest — which for sizes reads
    # largest to smallest — so the landing page and the admin agree on order.
    variants: Mapped[list["ProductVariant"]] = relationship(
        lazy="selectin",
        order_by="[ProductVariant.is_default.desc(), ProductVariant.unit_price.desc(), ProductVariant.id]",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # "Only one may be active per store" enforced by the database rather
        # than by application code, so a concurrent activate cannot leave two
        # winners. A partial index constrains only rows where is_active is true.
        Index(
            "uq_products_single_active_per_store",
            "store_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        Index("ix_products_store_id_created_at", "store_id", "created_at"),
    )


class ProductVariant(Base):
    """
    One version of a product — a size, a pack — and the thing an order line
    actually names. Everything that differs between versions lives here: the
    price, the picture, the catalogue id the analytics events carry.

    A product with no variants cannot be sold, so activating one is refused
    until it has at least one; the first variant added becomes the default.
    """

    __tablename__ = "product_variants"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    # "২ কেজি". Empty on rows that predate variants, whose product title
    # already said everything; see catalogue.variant_title.
    label: Mapped[str] = mapped_column(String(120), default="")
    # Path relative to settings.media_root, e.g. "products/a1b2c3.jpg". Served
    # at /media/<image_path>; null until an image is uploaded.
    image_path: Mapped[str | None] = mapped_column(String(255))
    # Unit price in whole taka.
    unit_price: Mapped[int] = mapped_column(Integer)
    # Mirrors the item_id in frontend/src/lib/tracking.ts and the Meta CAPI
    # content id, so browser-side and server-side events agree on one id.
    sku: Mapped[str] = mapped_column(String(64))
    # How many one storefront order of this variant places.
    default_quantity: Mapped[int] = mapped_column(Integer, default=1)
    # The variant selected when the landing page loads, and what the old
    # storefront and an order that named no variant are priced against.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # One default per product, guaranteed by the database.
        Index(
            "uq_product_variants_single_default",
            "product_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )


class OrderItem(Base):
    """One product line on an order.

    The order keeps its own product_name / unit_price / total_amount columns:
    those are the summary the storefront, the courier and the sticker read, and
    a snapshot that must not move when a product is later edited. These rows are
    the detail behind that summary, so one order can hold several products and
    per-product figures stay reportable.
    """

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    # Goes null if the catalogue row is deleted. The name and price below are
    # the snapshot, so the line itself survives intact.
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL")
    )
    # Which version of it. Same rules as product_id: a link for reporting,
    # not the source of the name or the price.
    variant_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_variants.id", ondelete="SET NULL")
    )
    product_name: Mapped[str] = mapped_column(String(255))
    unit_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    @property
    def line_total(self) -> int:
        return self.unit_price * self.quantity


class Visit(Base):
    """One storefront page view, from the PageView report the page posts to
    /api/track. `visitor` is a hash — of the browser's _fbp cookie, or of the
    address and user agent when there is none — so distinct visitors can be
    counted without keeping anything that identifies a person. See api.visits.
    """

    __tablename__ = "visits"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="RESTRICT"))
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    visitor: Mapped[str] = mapped_column(String(32))
    path: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (Index("ix_visits_store_at", "store_id", "at"),)


class Store(Base):
    """
    One tenant of the platform: a shop with its own domain(s), template,
    theme and (later) its own catalogue, orders, staff and integration
    secrets. Every tenant-scoped table carries a store_id pointing here.
    """

    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    # "NB" in "NB-1042". Unique across stores so a number names one order.
    order_prefix: Mapped[str] = mapped_column(String(8), unique=True)
    template: Mapped[str] = mapped_column(String(40), default="classic")
    currency: Mapped[str] = mapped_column(String(3), default="BDT")
    theme: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Per-store overrides of the template's pictures/copy, by field key
    # (see api.routers.store_content). Absent = template default.
    content: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    domains: Mapped[list["StoreDomain"]] = relationship(
        lazy="selectin",
        order_by="[StoreDomain.is_primary.desc(), StoreDomain.id]",
        cascade="all, delete-orphan",
    )


class StoreDomain(Base):
    """A hostname that resolves to a store. Stored normalised (lowercase, no
    port); see api.stores.normalise_host."""

    __tablename__ = "store_domains"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), index=True
    )
    host: Mapped[str] = mapped_column(String(253), unique=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StoreRole(str, enum.Enum):
    """What a member may do inside one store. See api.tenancy for the
    permission set behind each."""

    owner = "owner"
    manager = "manager"
    staff = "staff"


class StoreUser(Base):
    """A platform user's access to one store. Super admins have no rows: they
    see every store. A user with no rows is signed in but sees only the
    waiting page."""

    __tablename__ = "store_users"

    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StoreSettings(Base):
    """
    Per-store integration configuration. Secrets are Fernet ciphertext in the
    *_enc columns (api.crypto); the API returns only whether they are set and
    their last characters. One row per store, created on first save.
    """

    __tablename__ = "store_settings"

    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True
    )
    meta_pixel_id: Mapped[str] = mapped_column(String(40), default="")
    meta_capi_token_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    meta_test_event_code: Mapped[str] = mapped_column(String(40), default="")
    pathao_client_id: Mapped[str] = mapped_column(String(120), default="")
    pathao_client_secret_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    pathao_email: Mapped[str] = mapped_column(String(255), default="")
    pathao_password_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    pathao_store_id: Mapped[int | None] = mapped_column(Integer)
    pathao_item_type: Mapped[str] = mapped_column(String(20), default="parcel")
    pathao_parcel_weight_kg: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=Decimal("1"))
    fraudbd_api_key_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class FraudCheck(Base):
    """
    One FraudBD lookup: how this phone number behaved with the couriers
    (delivered vs cancelled parcels, and Pathao's customer rating). Kept per
    store, since each store pays with its own key. A recent row is reused
    rather than asking again; see api.services.fraudbd.
    """

    __tablename__ = "fraud_checks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="RESTRICT"))
    phone_key: Mapped[str] = mapped_column(String(20))
    phone: Mapped[str] = mapped_column(String(32))
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    total: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[int] = mapped_column(Integer, default=0)
    cancel: Mapped[int] = mapped_column(Integer, default=0)
    success_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    pathao_rating: Mapped[str | None] = mapped_column(String(40))
    pathao_risk: Mapped[str | None] = mapped_column(String(20))
    couriers: Mapped[list] = mapped_column(JSONB, default=list)
    error: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_fraud_checks_store_phone_checked", "store_id", "phone_key", "checked_at"),
    )
