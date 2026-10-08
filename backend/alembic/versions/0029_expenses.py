"""Expenses: what each store spends, and the categories it adds

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-08

The CRM's first page records a store's purchases and bills. Two new tables,
both tenant-scoped with store_id first in every index, ON DELETE RESTRICT on
the store like every other business record. The default categories live in
code (api/routers/expenses.py) so a new store has them without a seed;
expense_categories holds only what a store adds. New tables: nothing to
backfill.
"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expenses",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "spent_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("category", sa.String(60), nullable=False),
        sa.Column("item", sa.String(200), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("payment_method", sa.String(20), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("added_by_name", sa.String(120), nullable=False),
        sa.Column(
            "added_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_expenses_store_spent_at", "expenses", ["store_id", "spent_at"])

    op.create_table(
        "expense_categories",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_expense_categories_store_name",
        "expense_categories",
        ["store_id", "name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_expense_categories_store_name", table_name="expense_categories")
    op.drop_table("expense_categories")
    op.drop_index("ix_expenses_store_spent_at", table_name="expenses")
    op.drop_table("expenses")
