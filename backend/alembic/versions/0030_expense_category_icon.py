"""expense_categories.icon: the picture a store chose for its own category

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-08

A store adding a category now picks an icon for it from a fixed list (the
admin's Lucide set); the default categories' icons live in code beside the
names. Stored as the icon's key, e.g. "shopping-basket". New rows always
carry one; existing rows (only dev data so far) get "tag", the icon a custom
category showed before, so nullable → backfill → NOT NULL.
"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("expense_categories", sa.Column("icon", sa.String(40), nullable=True))
    op.execute("UPDATE expense_categories SET icon = 'tag' WHERE icon IS NULL")
    op.alter_column("expense_categories", "icon", nullable=False)


def downgrade() -> None:
    op.drop_column("expense_categories", "icon")
