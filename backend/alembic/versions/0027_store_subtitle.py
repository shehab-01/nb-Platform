"""Store subtitle

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-21

A store's name is what the browser tab shows; staff also want a short
qualifier next to it inside the admin ("Nature Bazar — Ecotine" in the
sidebar and on the dashboard) without it leaking into the storefront tab
title. Optional, so nullable with no backfill.
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stores", sa.Column("subtitle", sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column("stores", "subtitle")
