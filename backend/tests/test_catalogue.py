"""for_order decides what an order is priced against. It must never resolve
to something this store is not selling right now, whatever id a page sends."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from api import catalogue
from api.models import Product, ProductVariant


class FakeSession:
    """Just enough of AsyncSession.get for for_order: rows by (model, id)."""

    def __init__(self, *rows) -> None:
        self.rows = {(type(r), r.id): r for r in rows}

    async def get(self, model, key):
        return self.rows.get((model, key))


def product(id: int, store_id: int, is_active: bool) -> Product:
    return Product(id=id, store_id=store_id, title="Honey", is_active=is_active)


def variant(id: int, product_id: int) -> ProductVariant:
    return ProductVariant(
        id=id, product_id=product_id, label="1 kg", unit_price=900, sku="H1", is_default=True
    )


def test_live_variant_of_this_store_sells():
    session = FakeSession(product(1, 7, True), variant(10, 1))
    sold = asyncio.run(catalogue.for_order(session, 7, 10))
    assert sold is not None
    assert (sold.product_id, sold.variant_id, sold.unit_price) == (1, 10, 900)
    assert sold.title == "Honey — 1 kg"


def test_unknown_variant_is_refused():
    session = FakeSession(product(1, 7, True))
    assert asyncio.run(catalogue.for_order(session, 7, 99)) is None


def test_another_stores_variant_is_refused():
    session = FakeSession(product(1, 8, True), variant(10, 1))
    assert asyncio.run(catalogue.for_order(session, 7, 10)) is None


def test_variant_of_a_product_taken_off_sale_is_refused():
    # A tab opened before the admin activated a different product still
    # names the old variant; the order must not go through at the old price.
    session = FakeSession(product(1, 7, False), variant(10, 1))
    assert asyncio.run(catalogue.for_order(session, 7, 10)) is None


def test_no_variant_means_the_default_of_the_live_product(monkeypatch):
    calls: list[int] = []

    async def fake_active(session, store_id):
        calls.append(store_id)
        return SimpleNamespace(variant_id=5)

    monkeypatch.setattr(catalogue, "active", fake_active)
    sold = asyncio.run(catalogue.for_order(FakeSession(), 7, None))
    assert sold.variant_id == 5
    assert calls == [7]
