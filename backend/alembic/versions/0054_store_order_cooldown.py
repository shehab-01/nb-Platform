"""stores.order_cooldown_hours: the repeat-order block, chosen per store

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-07

How long a phone number that has ordered is refused another storefront
order was one platform-wide env value (ORDER_COOLDOWN_HOURS). Stores want
different rules — one blocks a number for good, another for a few days — and
staff want to change it from the store form without a deploy. 0 means for
good, which is what every existing store gets.
"""
from alembic import op
import sqlalchemy as sa

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column("order_cooldown_hours", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("stores", "order_cooldown_hours")
