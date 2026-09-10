"""orders, order_events, visits and meta_capi_failed_events get store_id;
stores get an order number prefix; Pathao tokens are per store

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-10

Add nullable → backfill → NOT NULL. Rows that predate stores (none in a fresh
deployment; the v1 import sets store_id explicitly) go to the lowest-id store.
Tenant indexes are re-led by store_id. integration_tokens is a cache of
courier tokens and is simply emptied before its key changes.
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

TABLES = ("orders", "order_events", "visits", "meta_capi_failed_events")


def upgrade() -> None:
    # --- order number prefix ------------------------------------------------
    op.add_column("stores", sa.Column("order_prefix", sa.String(8), nullable=True))
    op.execute(
        """
        UPDATE stores
        SET order_prefix = upper(left(regexp_replace(slug, '[^a-z0-9]', '', 'g'), 8))
        WHERE order_prefix IS NULL
        """
    )
    op.alter_column("stores", "order_prefix", nullable=False)
    op.create_index("uq_stores_order_prefix", "stores", ["order_prefix"], unique=True)

    # --- store_id on the tenant tables ---------------------------------------
    for table in TABLES:
        op.add_column(table, sa.Column("store_id", sa.BigInteger(), nullable=True))
        op.execute(
            f"UPDATE {table} SET store_id = (SELECT min(id) FROM stores) WHERE store_id IS NULL"
        )
        op.alter_column(table, "store_id", nullable=False)
        op.create_foreign_key(
            f"fk_{table}_store_id", table, "stores", ["store_id"], ["id"], ondelete="RESTRICT"
        )

    # orders: the list query and the per-number lookups, led by store.
    op.drop_index("ix_orders_status_created_at", table_name="orders")
    op.create_index(
        "ix_orders_store_status_created_at", "orders", ["store_id", "status", "created_at"]
    )
    op.create_index("ix_orders_store_phone_key", "orders", ["store_id", "phone_key"])
    op.create_index("ix_orders_store_created_at", "orders", ["store_id", "created_at"])
    # order_events: the dashboard aggregates per actor and per day.
    op.create_index(
        "ix_order_events_store_actor_type", "order_events", ["store_id", "actor_id", "event_type"]
    )
    op.create_index("ix_order_events_store_created_at", "order_events", ["store_id", "created_at"])
    op.create_index("ix_visits_store_at", "visits", ["store_id", "at"])
    op.create_index("ix_meta_capi_failed_events_store_id", "meta_capi_failed_events", ["store_id"])

    # --- Pathao tokens per store ----------------------------------------------
    op.execute("DELETE FROM integration_tokens")
    op.add_column("integration_tokens", sa.Column("store_id", sa.BigInteger(), nullable=False))
    op.drop_constraint("integration_tokens_pkey", "integration_tokens", type_="primary")
    op.create_primary_key(
        "integration_tokens_pkey", "integration_tokens", ["store_id", "provider"]
    )
    op.create_foreign_key(
        "fk_integration_tokens_store_id", "integration_tokens", "stores", ["store_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_integration_tokens_store_id", "integration_tokens", type_="foreignkey")
    op.drop_constraint("integration_tokens_pkey", "integration_tokens", type_="primary")
    op.drop_column("integration_tokens", "store_id")
    op.create_primary_key("integration_tokens_pkey", "integration_tokens", ["provider"])

    op.drop_index("ix_meta_capi_failed_events_store_id", table_name="meta_capi_failed_events")
    op.drop_index("ix_visits_store_at", table_name="visits")
    op.drop_index("ix_order_events_store_created_at", table_name="order_events")
    op.drop_index("ix_order_events_store_actor_type", table_name="order_events")
    op.drop_index("ix_orders_store_created_at", table_name="orders")
    op.drop_index("ix_orders_store_phone_key", table_name="orders")
    op.drop_index("ix_orders_store_status_created_at", table_name="orders")
    op.create_index("ix_orders_status_created_at", "orders", ["status", "created_at"])
    for table in TABLES:
        op.drop_constraint(f"fk_{table}_store_id", table, type_="foreignkey")
        op.drop_column(table, "store_id")
    op.drop_index("uq_stores_order_prefix", table_name="stores")
    op.drop_column("stores", "order_prefix")
