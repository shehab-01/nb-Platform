"""orders.confirmed_by: who confirmed the order, kept after it moves on

Revision ID: 0046
Revises: 0045
Create Date: 2026-10-15

handled_by credits whoever last moved an order, so by the time an order is
shipped or archived it names the shipper, not the person who confirmed it.
The History list and the order modal need "confirmed by", so it gets its own
column, set when an order is put on Confirmed or taken by hand as confirmed.

Existing orders are filled in from the audit trail: the last staff member to
move each order to Confirmed, else the one who typed it in as confirmed.
Orders with neither (confirmed before events were kept) stay empty.
"""
from alembic import op
import sqlalchemy as sa

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column(
            "confirmed_by",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.execute(
        """
        UPDATE orders o
        SET confirmed_by = e.actor_id
        FROM (
            SELECT DISTINCT ON (order_id) order_id, actor_id
            FROM order_events
            WHERE new_status = 'confirmed'
              AND event_type IN ('status_changed', 'manual_created')
              AND actor_id IS NOT NULL
            ORDER BY order_id, created_at DESC, id DESC
        ) e
        WHERE o.id = e.order_id
        """
    )


def downgrade() -> None:
    op.drop_column("orders", "confirmed_by")
