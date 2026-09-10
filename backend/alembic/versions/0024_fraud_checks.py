"""fraud_checks: FraudBD courier-history lookups per customer phone, and the
order's pointer to the check that was run for it

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-10

One row per lookup, so history is kept and a recent check is reused instead
of paying for the same phone twice. The summary columns are what the tables
and modals show; the per-courier detail stays as JSON.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fraud_checks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        # Normalised phone (api.phone.phone_key), the lookup key.
        sa.Column("phone_key", sa.String(20), nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        # Delivery-count totals across couriers (Pathao's rating-based answer
        # is excluded from these by FraudBD itself).
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cancel", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_rate", sa.Numeric(5, 2), nullable=True),
        # Pathao's rating, when it answers with one: excellent_customer …
        sa.Column("pathao_rating", sa.String(40), nullable=True),
        sa.Column("pathao_risk", sa.String(20), nullable=True),
        # Per-courier summaries as returned, for the cards.
        sa.Column("couriers", postgresql.JSONB(), nullable=False, server_default="[]"),
        # Set when FraudBD could not answer (bad key, quota, network).
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_fraud_checks_store_phone_checked",
        "fraud_checks",
        ["store_id", "phone_key", "checked_at"],
    )
    op.add_column("orders", sa.Column("fraud_check_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_orders_fraud_check_id", "orders", "fraud_checks", ["fraud_check_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_orders_fraud_check_id", "orders", type_="foreignkey")
    op.drop_column("orders", "fraud_check_id")
    op.drop_index("ix_fraud_checks_store_phone_checked", table_name="fraud_checks")
    op.drop_table("fraud_checks")
