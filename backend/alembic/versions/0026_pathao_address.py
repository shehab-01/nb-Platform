"""Pathao delivery location on orders, and a cache for Pathao's address parser

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-17

Pathao's create-order call takes recipient_city / recipient_zone /
recipient_area ids. Until now we sent none and let Pathao sort the parcel from
the free-text address; staff now see the parsed location before booking and
can correct it, so the chosen ids live on the order. pathao_address_parse
keeps the parser's full answer (precise or coarse chain, history-verified or
not) next to those ids, for tracing failed deliveries and as a growing
address→zone dataset. pathao_address_parses caches parser answers by a hash
of the normalised address, platform-wide, because the answer does not depend
on the merchant. All nullable: nothing to backfill.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("pathao_city_id", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("pathao_zone_id", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("pathao_area_id", sa.Integer(), nullable=True))
    op.add_column(
        "orders",
        sa.Column("pathao_address_parse", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "pathao_address_parses",
        sa.Column("address_key", sa.String(length=64), primary_key=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("pathao_address_parses")
    op.drop_column("orders", "pathao_address_parse")
    op.drop_column("orders", "pathao_area_id")
    op.drop_column("orders", "pathao_zone_id")
    op.drop_column("orders", "pathao_city_id")
