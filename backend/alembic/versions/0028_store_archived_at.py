"""Store archive

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-05

A super admin needs to retire a store without losing it: its orders,
customers and media are business records, and every tenant table holds its
store with ON DELETE RESTRICT on purpose. Archiving stamps archived_at on an
inactive store; the admin then leaves it out of its lists, and restoring
clears the stamp. Nothing is deleted. Nullable, no backfill: no store starts
archived.
"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("stores", "archived_at")
