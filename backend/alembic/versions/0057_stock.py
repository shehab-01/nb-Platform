"""Stock: packets in hand, from received slots, History and courier returns

Revision ID: 0057
Revises: 0056
Create Date: 2026-11-19

Eco-Tine needs to know how many packets it actually has. Packets come in
when a production slot is received, go out when an order is moved to
History (the step after the courier entry and the sticker), and come back
when the courier returns some. Every production feeds the one stock.

  stores.stock_enabled           the per-store switch. Off for every
                                 existing store, so nothing changes for them.
  product_variants.stock_packets how many packets one of this option takes
                                 out of stock: 3 for the 3-packet combo. 1 for
                                 every existing option, which is what a plain
                                 one-item option means.
  stock_movements                the ledger. Stock in hand is the sum of
                                 packets (signed: + in, − out). kind says why:
                                   slot    a production slot received (one row
                                           per slot, kept in step with it)
                                   sale    an order moved to History (one row
                                           per order; removed if it leaves)
                                   return  combos the courier brought back
                                   adjust  a correction typed by an admin
                                 The partial unique indexes make "one row per
                                 slot" and "one sale per order" a database
                                 rule, so the Sync button can run any number
                                 of times without counting anything twice.

The new columns are added with a server default, which fills every existing
row in the same statement; the new table needs no backfill — the Stock page's
Sync button fills it from the slots and History already there.
"""
from alembic import op
import sqlalchemy as sa

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column("stock_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "product_variants",
        sa.Column("stock_packets", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        # The Dhaka day it counts on: the slot's received_on, the day the
        # order went to History, the day the return was entered.
        sa.Column("on_day", sa.Date(), nullable=False),
        sa.Column("packets", sa.Integer(), nullable=False),
        sa.Column(
            "slot_id",
            sa.BigInteger(),
            sa.ForeignKey("production_slots.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "order_id",
            sa.BigInteger(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        # A return: which option came back and how many of it. The option's
        # name is copied, so deleting it later leaves the row readable.
        sa.Column(
            "variant_id",
            sa.BigInteger(),
            sa.ForeignKey("product_variants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("variant_name", sa.String(length=255), nullable=True),
        sa.Column("combos", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column(
            "created_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_stock_movements_store_day", "stock_movements", ["store_id", "on_day"])
    op.create_index(
        "uq_stock_movements_store_slot",
        "stock_movements",
        ["store_id", "slot_id"],
        unique=True,
        postgresql_where=sa.text("slot_id IS NOT NULL"),
    )
    op.create_index(
        "uq_stock_movements_store_sale",
        "stock_movements",
        ["store_id", "order_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'sale'"),
    )


def downgrade() -> None:
    op.drop_index("uq_stock_movements_store_sale", table_name="stock_movements")
    op.drop_index("uq_stock_movements_store_slot", table_name="stock_movements")
    op.drop_index("ix_stock_movements_store_day", table_name="stock_movements")
    op.drop_table("stock_movements")
    op.drop_column("product_variants", "stock_packets")
    op.drop_column("stores", "stock_enabled")
