"""products.store_id: the catalogue becomes per store

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-10

Add nullable → backfill → NOT NULL. Rows that exist before any store does
(migration 0011 seeds v1's product) get a store created for them here, so the
constraint can be applied on any database this runs against. The global
"one active product" index becomes one per store.
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("store_id", sa.BigInteger(), nullable=True))
    # Backfill: orphan products go to the lowest-id store, which is created
    # first if there is none at all.
    op.execute(
        """
        INSERT INTO stores (slug, name, template, currency, theme)
        SELECT 'default', 'Default Store', 'classic', 'BDT', '{}'::jsonb
        WHERE EXISTS (SELECT 1 FROM products)
          AND NOT EXISTS (SELECT 1 FROM stores)
        """
    )
    op.execute(
        """
        UPDATE products
        SET store_id = (SELECT min(id) FROM stores)
        WHERE store_id IS NULL
        """
    )
    op.alter_column("products", "store_id", nullable=False)
    op.create_foreign_key(
        "fk_products_store_id", "products", "stores", ["store_id"], ["id"],
        ondelete="RESTRICT",
    )
    op.drop_index("uq_products_single_active", table_name="products")
    op.create_index(
        "uq_products_single_active_per_store",
        "products",
        ["store_id"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.create_index("ix_products_store_id_created_at", "products", ["store_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_products_store_id_created_at", table_name="products")
    op.drop_index("uq_products_single_active_per_store", table_name="products")
    op.create_index(
        "uq_products_single_active",
        "products",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.drop_constraint("fk_products_store_id", "products", type_="foreignkey")
    op.drop_column("products", "store_id")
