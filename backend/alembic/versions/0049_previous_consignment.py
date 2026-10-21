"""orders.previous_*: the booking an order was moved off

Revision ID: 0049
Revises: 0048
Create Date: 2026-10-21

Parcels sent to the wrong courier can now be booked again with the other one
(courier/send with rebook). The courier_* columns then describe the new
booking, so the one it replaced is kept here — the order list shows both, so
staff can still find and cancel the old consignment on that courier's panel.
Nothing to backfill: no order has been moved before this release.
"""
from alembic import op
import sqlalchemy as sa

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("previous_courier_provider", sa.String(20), nullable=True))
    op.add_column("orders", sa.Column("previous_consignment_id", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "previous_consignment_id")
    op.drop_column("orders", "previous_courier_provider")
