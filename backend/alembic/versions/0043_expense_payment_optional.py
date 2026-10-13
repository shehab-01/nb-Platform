"""expenses.payment_method: may be empty

Revision ID: 0043
Revises: 0042
Create Date: 2026-10-13

The expenses a production sends are not paid in one way that the production
knows of, so they carry no payment method. Expenses typed by hand still
need one (ExpenseIn); only the column stops insisting.
"""
from alembic import op
import sqlalchemy as sa

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "expenses", "payment_method", existing_type=sa.String(20), nullable=True
    )


def downgrade() -> None:
    op.execute("UPDATE expenses SET payment_method = 'other' WHERE payment_method IS NULL")
    op.alter_column(
        "expenses", "payment_method", existing_type=sa.String(20), nullable=False
    )
