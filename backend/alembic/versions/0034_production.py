"""production: what a day of cooking costs, down to the jar

Revision ID: 0034
Revises: 0033
Create Date: 2026-10-09

The CRM's Production Cost page. A day is a production day when it has a
production_days row (one per store per day); the bazar list, the achar
batches cooked and the other costs hang off it. The day's totals are worked
out by the server when it is saved and stored on the row, so a past day reads
as it was saved and the recent-days list needs no joins. production_achars
is the store's own list of achar types. New tables, store_id first in every
tenant index: nothing to backfill.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def _store_id() -> sa.Column:
    return sa.Column(
        "store_id",
        sa.BigInteger(),
        sa.ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
    )


def _day_id() -> sa.Column:
    return sa.Column(
        "production_day_id",
        sa.BigInteger(),
        sa.ForeignKey("production_days.id", ondelete="CASCADE"),
        nullable=False,
    )


def _now(name: str) -> sa.Column:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "production_days",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store_id(),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("starts_at", sa.Time(), nullable=True),
        sa.Column("ends_at", sa.Time(), nullable=True),
        sa.Column(
            "shifts",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("male_cooks", sa.Integer(), nullable=False),
        sa.Column("male_rate", sa.Integer(), nullable=False),
        sa.Column("female_cooks", sa.Integer(), nullable=False),
        sa.Column("female_rate", sa.Integer(), nullable=False),
        sa.Column("gas_cost", sa.Integer(), nullable=False),
        sa.Column("packaging_cost", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("materials_cost", sa.Integer(), nullable=False),
        sa.Column("labour_cost", sa.Integer(), nullable=False),
        sa.Column("misc_cost", sa.Integer(), nullable=False),
        sa.Column("total_cost", sa.Integer(), nullable=False),
        sa.Column("patils", sa.Integer(), nullable=False),
        sa.Column("jars", sa.Integer(), nullable=False),
        sa.Column(
            "created_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        _now("created_at"),
        _now("updated_at"),
    )
    op.create_index(
        "ix_production_days_store_day", "production_days", ["store_id", "day"], unique=True
    )

    op.create_table(
        "production_materials",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store_id(),
        _day_id(),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("item", sa.String(120), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("unit_price", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_production_materials_store_day",
        "production_materials",
        ["store_id", "production_day_id"],
    )

    op.create_table(
        "production_batches",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store_id(),
        _day_id(),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("achar", sa.String(80), nullable=False),
        sa.Column("patils", sa.Integer(), nullable=False),
        sa.Column("jars_per_patil", sa.Integer(), nullable=False),
        sa.Column("jars", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_production_batches_store_day",
        "production_batches",
        ["store_id", "production_day_id"],
    )

    op.create_table(
        "production_misc",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store_id(),
        _day_id(),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(80), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
    )
    op.create_index(
        "ix_production_misc_store_day", "production_misc", ["store_id", "production_day_id"]
    )

    op.create_table(
        "production_achars",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store_id(),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("icon", sa.String(40), nullable=False, server_default="cooking-pot"),
        _now("created_at"),
    )
    op.create_index(
        "ix_production_achars_store_name",
        "production_achars",
        ["store_id", "name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_production_achars_store_name", table_name="production_achars")
    op.drop_table("production_achars")
    op.drop_index("ix_production_misc_store_day", table_name="production_misc")
    op.drop_table("production_misc")
    op.drop_index("ix_production_batches_store_day", table_name="production_batches")
    op.drop_table("production_batches")
    op.drop_index("ix_production_materials_store_day", table_name="production_materials")
    op.drop_table("production_materials")
    op.drop_index("ix_production_days_store_day", table_name="production_days")
    op.drop_table("production_days")
