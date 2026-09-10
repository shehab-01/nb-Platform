"""What the shop is currently selling.

One place decides which product an order is priced against, so the storefront,
the order endpoints and the Meta CAPI events can never disagree about the name,
the price or the catalogue id.

A product is a group; its variants (sizes, packs) are what actually sell. The
landing page shows the active product and offers its variants, with the default
one selected. The old storefront, and any order that names no variant, sells
that default.

There is no fallback: with nothing live the storefront says so and takes no
orders. Selling a product that nobody put in the catalogue, at a price nobody
set, is worse than selling nothing.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models import Product, ProductVariant


@dataclass(frozen=True)
class Sellable:
    """The fields order creation and the Purchase event need about one thing
    sold — a variant together with its product's name — whatever the source."""

    title: str
    unit_price: int
    sku: str
    product_id: int
    variant_id: int


def variant_title(product_title: str, label: str) -> str:
    """The name an order, the picker and the page heading show: the product
    and its size, or just the product on a variant that has no label."""
    return f"{product_title} — {label}" if label else product_title


def sellable(product: Product, variant: ProductVariant) -> Sellable:
    return Sellable(
        title=variant_title(product.title, variant.label),
        unit_price=variant.unit_price,
        sku=variant.sku,
        product_id=product.id,
        variant_id=variant.id,
    )


async def active_product(session: AsyncSession, store_id: int) -> Product | None:
    """The store's active product row, variants included, or None."""
    result = await session.execute(
        select(Product)
        .where(Product.store_id == store_id, Product.is_active.is_(True))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def active(session: AsyncSession, store_id: int) -> Sellable | None:
    """What to sell when nothing more specific was asked for: the store's live
    product's default variant, or None when nothing is live."""
    product = await active_product(session, store_id)
    if product is not None and product.variants:
        # Ordered default-first by the relationship.
        return sellable(product, product.variants[0])
    return None


async def for_order(
    session: AsyncSession, store_id: int, variant_id: int | None
) -> Sellable | None:
    """What to price an order against: the variant the customer picked, or the
    store's default when the form did not say (the old storefront never does).

    None when an id was sent and matches nothing in this store — a stale page
    after a variant was deleted, a made-up id, or another store's variant —
    or when nothing was sent and nothing is live. Either way the caller
    refuses the order rather than quietly selling something else.
    """
    if variant_id is None:
        return await active(session, store_id)
    variant = await session.get(ProductVariant, variant_id)
    if variant is None:
        return None
    product = await session.get(Product, variant.product_id)
    if product is None or product.store_id != store_id:
        return None
    return sellable(product, variant)
