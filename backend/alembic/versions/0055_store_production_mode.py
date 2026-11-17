"""stores.production_mode: how a store records its production

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-17

The Production pages were built around one way of producing: a store cooks
on a day, with cooks, a bazar and jars (production_days). Not every store
works like that. Eco-Tine opens a production order of so many packets, buys
the packaging for all of it up front, and receives the finished packets in
slots over the following days. So a store now says which kind of Production
page it uses, the way it says which storefront template it renders:

  cooking  the day-by-day kitchen pages (every existing store)
  batch    an order of N packets received in slots (production_runs, 0056)

Added nullable, filled with "cooking" for every existing store, then made
NOT NULL with that default for stores created later.
"""
from alembic import op
import sqlalchemy as sa

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stores", sa.Column("production_mode", sa.String(length=20), nullable=True))
    op.execute("UPDATE stores SET production_mode = 'cooking' WHERE production_mode IS NULL")
    op.alter_column(
        "stores", "production_mode", nullable=False, server_default="cooking"
    )


def downgrade() -> None:
    op.drop_column("stores", "production_mode")
