"""production: a store's raw-material items, and "products" instead of "achars"

Revision ID: 0035
Revises: 0034
Create Date: 2026-10-10

The bazar list is now picked from the store's own items (a name and a unit,
no price: a day records what it paid, so a later price never rewrites an
earlier day). production_items holds them, seeded here with a few basics for
every existing store; new stores get the same from api.routers.production
when they are created. The cooked side becomes generic — what a store cooks
is a "product", not necessarily an achar — so production_achars becomes
production_products and production_batches.achar becomes .product. Renames
keep every row; the new table is store_id-first like every tenant table.
"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

# A copy, not an import: a migration must not change when the app does.
DEFAULT_ITEMS = (
    ("Mustard oil", "L"),
    ("Mustard seed", "kg"),
    ("Fenugreek", "kg"),
    ("Garlic", "kg"),
    ("Green chili", "kg"),
    ("Ginger", "kg"),
    ("Salt", "kg"),
    ("Spice mix", "kg"),
)


def upgrade() -> None:
    op.rename_table("production_achars", "production_products")
    op.execute(
        "ALTER INDEX ix_production_achars_store_name RENAME TO ix_production_products_store_name"
    )
    op.execute(
        "ALTER SEQUENCE IF EXISTS production_achars_id_seq RENAME TO production_products_id_seq"
    )
    op.execute(
        "ALTER TABLE production_products RENAME CONSTRAINT production_achars_pkey TO production_products_pkey"
    )
    op.execute(
        "ALTER TABLE production_products "
        "RENAME CONSTRAINT production_achars_store_id_fkey TO production_products_store_id_fkey"
    )
    op.alter_column("production_batches", "achar", new_column_name="product")

    items = op.create_table(
        "production_items",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("unit", sa.String(20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_production_items_store_name", "production_items", ["store_id", "name"], unique=True
    )
    store_ids = [row[0] for row in op.get_bind().execute(sa.text("SELECT id FROM stores"))]
    if store_ids:
        op.bulk_insert(
            items,
            [
                {"store_id": s, "name": name, "unit": unit}
                for s in store_ids
                for name, unit in DEFAULT_ITEMS
            ],
        )


def downgrade() -> None:
    op.drop_index("ix_production_items_store_name", table_name="production_items")
    op.drop_table("production_items")
    op.alter_column("production_batches", "product", new_column_name="achar")
    op.execute(
        "ALTER TABLE production_products "
        "RENAME CONSTRAINT production_products_store_id_fkey TO production_achars_store_id_fkey"
    )
    op.execute(
        "ALTER TABLE production_products RENAME CONSTRAINT production_products_pkey TO production_achars_pkey"
    )
    op.execute(
        "ALTER SEQUENCE IF EXISTS production_products_id_seq RENAME TO production_achars_id_seq"
    )
    op.execute(
        "ALTER INDEX ix_production_products_store_name RENAME TO ix_production_achars_store_name"
    )
    op.rename_table("production_products", "production_achars")
