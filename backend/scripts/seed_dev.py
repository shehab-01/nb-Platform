"""
Seed a fresh development database: one super admin, two demo stores on
different hostnames, and a live product so the storefronts have something to
render. Idempotent — run it as often as you like.

    docker compose exec api python -m scripts.seed_dev

The super admin's email comes from DEV_LOGIN_EMAIL (falling back to the first
of SUPER_ADMIN_EMAILS). The store hostnames come from DEV_STORE_HOSTS as
"slug=host,slug=host" and default to the nb.local names DEV.md documents.

Development only. Never run this against a production database: it creates
a product that sells.
"""
from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import select

from api.config import settings
from api.db import async_session, engine
from api.models import (
    Product,
    ProductVariant,
    Store,
    StoreDomain,
    StoreRole,
    StoreUser,
    User,
    UserRole,
    UserStatus,
)
from api.stores import normalise_host

DEFAULT_STORES = {
    "store1": {
        "name": "Store One",
        "order_prefix": "ONE",
        "hosts": ["store1.nb.local"],
        "theme": {"primary": "#1f7a3a", "accent": "#f2b632", "background": "#f7f8f3"},
    },
    "store2": {
        "name": "Store Two",
        "order_prefix": "TWO",
        "template": "campaign",
        "hosts": ["store2.nb.local"],
        "theme": {"primary": "#b3471d", "accent": "#2a6f97", "background": "#fbf6f1"},
    },
}


def _store_hosts() -> dict[str, list[str]]:
    """slug -> hosts, from DEV_STORE_HOSTS or the defaults."""
    raw = os.getenv("DEV_STORE_HOSTS", "").strip()
    if not raw:
        return {slug: spec["hosts"] for slug, spec in DEFAULT_STORES.items()}
    out: dict[str, list[str]] = {}
    for pair in raw.split(","):
        slug, _, host = pair.partition("=")
        if slug.strip() and host.strip():
            out.setdefault(slug.strip(), []).append(host.strip())
    return out


async def seed() -> None:
    email = settings.dev_login_email or next(iter(sorted(settings.super_admin_emails)), "")
    if not email:
        sys.exit("Set DEV_LOGIN_EMAIL (or SUPER_ADMIN_EMAILS) before seeding")

    async with async_session() as session:
        user = await session.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                name=email.split("@")[0],
                nickname="Admin",
                role=UserRole.super_admin,
                status=UserStatus.active,
            )
            session.add(user)
            print(f"created super admin {email}")
        else:
            user.role = UserRole.super_admin
            user.status = UserStatus.active
            print(f"super admin {email} already present")

        for slug, hosts in _store_hosts().items():
            spec = DEFAULT_STORES.get(slug, {})
            store = await session.scalar(select(Store).where(Store.slug == slug))
            if store is None:
                store = Store(
                    slug=slug,
                    name=spec.get("name", slug.title()),
                    order_prefix=spec.get("order_prefix", slug[:8].upper()),
                    template=spec.get("template", "classic"),
                    currency="BDT",
                    theme=spec.get("theme", {}),
                )
                session.add(store)
                await session.flush()
                print(f"created store {slug}")
            # Queried rather than read off the relationship: a store flushed a
            # moment ago has not loaded its domains, and a lazy load inside an
            # async session is an error.
            existing = set(
                await session.scalars(
                    select(StoreDomain.host).where(StoreDomain.store_id == store.id)
                )
            )
            for i, raw in enumerate(hosts):
                host = normalise_host(raw)
                if host and host not in existing:
                    session.add(
                        StoreDomain(store_id=store.id, host=host, is_primary=(i == 0 and not existing))
                    )
                    print(f"  {slug} <- {host}")

        await session.flush()

        # Migration 0020 has to park v1's seeded product (migration 0011) on
        # some store, and on a fresh database it creates one called "default"
        # to do so. It has no domain and no storefront; in production the v1
        # data is imported into a store created on purpose, so the artifact
        # only ever exists in development. Remove it and its product.
        artifact = await session.scalar(select(Store).where(Store.slug == "default"))
        if artifact is not None and "default" not in DEFAULT_STORES:
            for product in await session.scalars(
                select(Product).where(Product.store_id == artifact.id)
            ):
                await session.delete(product)
            await session.flush()
            await session.delete(artifact)
            await session.flush()
            print("removed the 'default' store left by migration 0020")

        stores_by_slug = {
            s.slug: s for s in (await session.scalars(select(Store))).all()
        }

        # The dev admin is also an owner of every demo store, so the switcher
        # can be exercised even if the super_admin role is removed in the UI.
        member_of = set(
            (await session.scalars(select(StoreUser.store_id).where(StoreUser.user_id == user.id))).all()
        )
        for store in stores_by_slug.values():
            if store.id not in member_of:
                session.add(StoreUser(store_id=store.id, user_id=user.id, role=StoreRole.owner.value))
                print(f"  {email} owner of {store.slug}")

        # Every demo store gets a product to sell, so each landing page renders
        # an offer rather than "closed". Migration 0020 may already have parked
        # v1's seeded product on the lowest-id store; that one is left alone.
        for slug, store in stores_by_slug.items():
            if slug not in DEFAULT_STORES:
                continue
            has_product = await session.scalar(
                select(Product.id).where(Product.store_id == store.id).limit(1)
            )
            if has_product is not None:
                continue
            product = Product(
                store_id=store.id,
                title=f"{store.name} Demo Honey",
                description="Seeded demo product. Edit or replace it in Admin → Products.",
                is_active=True,
                variants=[
                    ProductVariant(
                        label="1 kg", unit_price=1250, sku=f"{slug.upper()}-HONEY-1KG",
                        default_quantity=1, is_default=True,
                    ),
                    ProductVariant(
                        label="500 g", unit_price=700, sku=f"{slug.upper()}-HONEY-500G",
                        default_quantity=1, is_default=False,
                    ),
                ],
            )
            session.add(product)
            print(f"created demo product for {slug}")

        await session.commit()
    await engine.dispose()
    print("seed complete")


if __name__ == "__main__":
    asyncio.run(seed())
