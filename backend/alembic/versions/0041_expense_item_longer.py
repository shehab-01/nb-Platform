"""expenses.item: up to 1000 characters

Revision ID: 0041
Revises: 0040
Create Date: 2026-10-13

The expenses a production day files carry their whole breakdown in the
item — every raw material with its quantity and price, every group of
cooks — because the item is what the expense PDF prints. A long bazar list
does not fit in 200 characters. Widening a varchar keeps every value as it
is; expenses typed by hand are still held to 200 by the API.
"""
from alembic import op
import sqlalchemy as sa

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "expenses", "item", type_=sa.String(1000), existing_type=sa.String(200), existing_nullable=False
    )


def downgrade() -> None:
    # Values over 200 characters are cut, or the narrowing would fail.
    op.execute("UPDATE expenses SET item = left(item, 200) WHERE length(item) > 200")
    op.alter_column(
        "expenses", "item", type_=sa.String(200), existing_type=sa.String(1000), existing_nullable=False
    )
