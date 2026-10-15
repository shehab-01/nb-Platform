"""orders.pathao_checked_at: when the parcel was last asked about

Revision ID: 0044
Revises: 0043
Create Date: 2026-10-15

The background Pathao sync took the 200 newest unsettled parcels each round.
With more than 200 parcels in flight, the newest always filled the batch and
older ones were never asked again, so their deliveries never arrived. The
sync now goes by this timestamp instead, longest-unasked (or never asked)
first, so every parcel gets its turn.
"""
from alembic import op
import sqlalchemy as sa

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("pathao_checked_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("orders", "pathao_checked_at")
