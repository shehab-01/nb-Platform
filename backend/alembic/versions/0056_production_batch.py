"""production_runs and their slots: batch production (stores.production_mode = batch)

Revision ID: 0056
Revises: 0055
Create Date: 2026-11-17

A batch production is an order of so many packets (production_runs). What
it costs comes in two parts:

  production_run_costs   what is bought for the whole order up front — the
                         packets themselves, combo boxes, paper, labels, glue —
                         as quantity × unit price. The raw material (bought
                         by the kg, for a total) sits on the run itself, with
                         the kg actually used filled in when it is closed.
  production_slots       each delivery of finished packets, on the day it
  production_slot_costs  is received, with what that delivery costs: labour
                         per 1,000 pieces, a rate per packet, or a typed sum.

Received and pending are the slots' packets against the order's; the order
is closed once nothing is pending (or early, by a super admin). Names and
units are copied onto each line, as production_days does, so the past reads
as it was saved. Unit prices and rates keep their paisa (৳3.15 a packet);
every amount is whole taka, worked out by the server.

New tables, so no backfill. Every index starts with store_id.
"""
from alembic import op
import sqlalchemy as sa

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def _store() -> sa.Column:
    return sa.Column(
        "store_id",
        sa.BigInteger(),
        sa.ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
    )


def _user(name: str) -> sa.Column:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


def _stamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "production_runs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store(),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("opened_on", sa.Date(), nullable=False),
        sa.Column("units", sa.Integer(), nullable=False),
        sa.Column("pieces_per_packet", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("raw_kg", sa.Numeric(12, 3), nullable=True),
        sa.Column("raw_cost", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw_used_kg", sa.Numeric(12, 3), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        _user("closed_by_id"),
        sa.Column("closed_early", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        _user("created_by_id"),
        _user("updated_by_id"),
        *_stamps(),
    )
    op.create_index(
        "ix_production_runs_store_opened", "production_runs", ["store_id", "opened_on"]
    )

    op.create_table(
        "production_run_costs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store(),
        sa.Column(
            "run_id",
            sa.BigInteger(),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("item", sa.String(length=120), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=True),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("follows_units", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("amount", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_production_run_costs_store_run", "production_run_costs", ["store_id", "run_id"]
    )

    op.create_table(
        "production_slots",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store(),
        sa.Column(
            "run_id",
            sa.BigInteger(),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column("packets", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("total_cost", sa.Integer(), nullable=False, server_default="0"),
        _user("created_by_id"),
        _user("updated_by_id"),
        *_stamps(),
    )
    op.create_index(
        "ix_production_slots_store_run_number",
        "production_slots",
        ["store_id", "run_id", "number"],
        unique=True,
    )

    op.create_table(
        "production_slot_costs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _store(),
        sa.Column(
            "slot_id",
            sa.BigInteger(),
            sa.ForeignKey("production_slots.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("basis", sa.String(length=20), nullable=False),
        sa.Column("rate", sa.Numeric(12, 2), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_production_slot_costs_store_slot", "production_slot_costs", ["store_id", "slot_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_production_slot_costs_store_slot", table_name="production_slot_costs")
    op.drop_table("production_slot_costs")
    op.drop_index("ix_production_slots_store_run_number", table_name="production_slots")
    op.drop_table("production_slots")
    op.drop_index("ix_production_run_costs_store_run", table_name="production_run_costs")
    op.drop_table("production_run_costs")
    op.drop_index("ix_production_runs_store_opened", table_name="production_runs")
    op.drop_table("production_runs")
