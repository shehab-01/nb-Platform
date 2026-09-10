"""Product catalogue: super-admin CRUD over products and their variants, plus
the public reads the storefronts need.

Two routers live here on purpose. Everything on `router` needs a signed-in
user, and every write on it a super admin; `public_router` carries only the
unauthenticated reads the landing pages call, so the gate is never
accidentally widened by adding a route to the wrong prefix. Staff can read
the catalogue because the manual order page sells from it.

A product is written as a whole — name, versions and description in one
request and one transaction — because that is how the admin edits it: one
dialog, one Save. The only write outside that is the picture, which has to be
sent as multipart against a row that already has an id.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import catalogue, media, stores, tenancy
from api.db import get_session
from api.models import Product, ProductVariant
from api.schemas import (
    ProductOut,
    ProductSave,
    ProductSaveOut,
    StorefrontListingOut,
    StorefrontProductOut,
    StorefrontVariantOut,
)

# Every route here works inside the store named by X-Admin-Store (see
# api.tenancy): reads need any store role, writes need owner or manager.
router = APIRouter(
    prefix="/products",
    tags=["Products"],
    dependencies=[Depends(tenancy.require("catalogue.read"))],
)
# Every write. Applied route by route rather than on the router so the one
# read stays open to staff.
WRITE = [Depends(tenancy.require("catalogue.write"))]

public_router = APIRouter(prefix="/storefront", tags=["Storefront"])


async def _get_or_404(session: AsyncSession, product_id: int, store_id: int) -> Product:
    """The product, if it belongs to this store. Another store's id is a 404,
    not a 403: nothing about it is disclosed."""
    product = await session.get(Product, product_id)
    if product is None or product.store_id != store_id:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def _variant_or_404(product: Product, variant_id: int) -> ProductVariant:
    for variant in product.variants:
        if variant.id == variant_id:
            return variant
    raise HTTPException(status_code=404, detail="Variant not found")


async def _reload(session: AsyncSession, product_id: int, store_id: int) -> Product:
    """The product as the database now has it. The variants list is loaded
    with the product, so after a write it is re-read rather than trusted."""
    session.expire_all()
    return await _get_or_404(session, product_id, store_id)


async def _all(session: AsyncSession, store_id: int) -> list[Product]:
    rows = await session.execute(
        # Active first, then newest, so the product that is actually selling
        # is always the one at the top of the page.
        select(Product)
        .where(Product.store_id == store_id)
        .order_by(Product.is_active.desc(), Product.created_at.desc())
    )
    return list(rows.scalars())


# --- Products ----------------------------------------------------------------


@router.get("", response_model=list[ProductOut])
async def list_products(
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.admin_store),
) -> list[Product]:
    return await _all(session, ctx.store.id)


async def _apply_variants(
    session: AsyncSession, product: Product, payload: ProductSave
) -> tuple[list[int], list[str | None]]:
    """Make the product's versions match the payload: rows it names are
    updated, rows without an id are inserted, rows it leaves out are deleted.

    Returns the ids in payload order, and the image paths of the deleted rows
    so the caller can remove the files once the transaction has committed.

    The default is cleared on every surviving row and flushed before it is set
    on the chosen one: the partial unique index allows one default per product,
    so the clearing must reach the database before the setting does.
    """
    existing = {v.id: v for v in product.variants}
    kept = {v.id for v in payload.variants if v.id is not None}
    unknown = kept - existing.keys()
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown version id(s): {', '.join(str(i) for i in sorted(unknown))}",
        )

    gone: list[str | None] = []
    for variant_id, row in existing.items():
        if variant_id in kept:
            row.is_default = False
        else:
            gone.append(row.image_path)
            await session.delete(row)
    await session.flush()

    rows: list[ProductVariant] = []
    default: ProductVariant | None = None
    for spec in payload.variants:
        if spec.id is not None:
            row = existing[spec.id]
            row.label = spec.label
            row.unit_price = spec.unit_price
            row.sku = spec.sku
            row.default_quantity = spec.default_quantity
        else:
            row = ProductVariant(
                product_id=product.id,
                label=spec.label,
                unit_price=spec.unit_price,
                sku=spec.sku,
                default_quantity=spec.default_quantity,
                is_default=False,
            )
            session.add(row)
        if spec.is_default:
            default = row
        rows.append(row)
    await session.flush()
    # The schema guarantees exactly one default, so this is never None.
    assert default is not None
    default.is_default = True
    await session.flush()
    return [row.id for row in rows], gone


async def _saved(
    session: AsyncSession, product_id: int, store_id: int, ids: list[int]
) -> ProductSaveOut:
    product = await _reload(session, product_id, store_id)
    return ProductSaveOut(product=ProductOut.model_validate(product), variant_ids=ids)


@router.post(
    "", response_model=ProductSaveOut, status_code=201, dependencies=WRITE
)
async def create_product(
    payload: ProductSave,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.admin_store),
) -> ProductSaveOut:
    product = Product(
        store_id=ctx.store.id,
        title=payload.title,
        description=payload.description,
        is_active=False,
        # Initialised here so the collection is known-empty: a freshly built
        # row has nothing loaded, and touching it after the flush would fire
        # a lazy load, which the async session cannot do.
        variants=[],
    )
    session.add(product)
    await session.flush()
    ids, _ = await _apply_variants(session, product, payload)
    await session.commit()
    return await _saved(session, product.id, ctx.store.id, ids)


@router.put("/{product_id}", response_model=ProductSaveOut, dependencies=WRITE)
async def save_product(
    product_id: int,
    payload: ProductSave,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.admin_store),
) -> ProductSaveOut:
    """Replace the product with what the editor holds. Versions left out of
    the payload are deleted, past orders keeping the name and price they
    recorded."""
    product = await _get_or_404(session, product_id, ctx.store.id)
    product.title = payload.title
    product.description = payload.description
    ids, gone = await _apply_variants(session, product, payload)
    await session.commit()
    # Only after the commit, so a failed save never loses a picture a row
    # still points at.
    for path in gone:
        media.delete_media(path)
    return await _saved(session, product_id, ctx.store.id, ids)


@router.post(
    "/{product_id}/activate", response_model=list[ProductOut], dependencies=WRITE
)
async def activate_product(
    product_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.admin_store),
) -> list[Product]:
    """Make this the product the storefront sells.

    The previous active row is cleared in the same transaction, and flushed
    before the new one is set: the partial unique index means two active rows
    can never both commit, so doing it in one order avoids tripping it.
    """
    product = await _get_or_404(session, product_id, ctx.store.id)
    if not product.variants:
        raise HTTPException(
            status_code=400,
            detail="Add at least one version before making this product live",
        )
    if not product.is_active:
        current = await catalogue.active_product(session, ctx.store.id)
        if current is not None:
            current.is_active = False
            await session.flush()
        product.is_active = True
        await session.commit()
    session.expire_all()
    return await _all(session, ctx.store.id)


@router.delete("/{product_id}", status_code=204, dependencies=WRITE)
async def delete_product(
    product_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.admin_store),
) -> None:
    product = await _get_or_404(session, product_id, ctx.store.id)
    if product.is_active:
        raise HTTPException(
            status_code=400,
            detail="Make another product live before deleting this one",
        )
    image_paths = [v.image_path for v in product.variants]
    await session.delete(product)
    await session.commit()
    for path in image_paths:
        media.delete_media(path)


@router.post(
    "/{product_id}/variants/{variant_id}/image",
    response_model=ProductOut,
    dependencies=WRITE,
)
async def upload_variant_image(
    product_id: int,
    variant_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    ctx: tenancy.StoreContext = Depends(tenancy.admin_store),
) -> Product:
    product = await _get_or_404(session, product_id, ctx.store.id)
    variant = _variant_or_404(product, variant_id)
    data = await file.read()
    try:
        path = media.save_product_image(data)
    except media.UploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    previous = variant.image_path
    variant.image_path = path
    await session.commit()
    # Only after the new path is safely committed, so a failed commit never
    # leaves the row pointing at a file that is already gone.
    media.delete_media(previous)
    return await _reload(session, product_id, ctx.store.id)


# --- Public ------------------------------------------------------------------


@public_router.get("/product", response_model=StorefrontProductOut)
async def storefront_product(
    session: AsyncSession = Depends(get_session),
    store: stores.StoreConfig = Depends(stores.current_store),
) -> StorefrontProductOut:
    """What the old storefront sells: the store's live product's default
    variant. 404 when nothing is live — there is nothing to sell."""
    product = await catalogue.active_product(session, store.id)
    if product is None or not product.variants:
        raise HTTPException(status_code=404, detail="Nothing is on sale")
    variant = product.variants[0]
    return StorefrontProductOut(
        title=catalogue.variant_title(product.title, variant.label),
        default_quantity=variant.default_quantity,
        unit_price=variant.unit_price,
        sku=variant.sku,
        image_path=variant.image_path,
    )


@public_router.get("/listing", response_model=StorefrontListingOut)
async def storefront_listing(
    session: AsyncSession = Depends(get_session),
    store: stores.StoreConfig = Depends(stores.current_store),
) -> StorefrontListingOut:
    """The landing page's offer: the store's live product with its variants,
    the default first. 404 when nothing is live: the page then says the shop
    is closed rather than inventing something to sell."""
    product = await catalogue.active_product(session, store.id)
    if product is None or not product.variants:
        raise HTTPException(status_code=404, detail="Nothing is on sale")
    return StorefrontListingOut(
        title=product.title,
        description=product.description,
        variants=[
            StorefrontVariantOut(
                id=variant.id,
                title=catalogue.variant_title(product.title, variant.label),
                label=variant.label,
                default_quantity=variant.default_quantity,
                unit_price=variant.unit_price,
                sku=variant.sku,
                is_default=variant.is_default,
                image_path=variant.image_path,
            )
            for variant in product.variants
        ],
    )
