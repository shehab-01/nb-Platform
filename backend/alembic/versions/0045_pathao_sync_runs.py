"""pathao_sync_runs: staff-started full Pathao syncs and their progress

Revision ID: 0045
Revises: 0044
Create Date: 2026-10-15

Delivery statuses feed the incentive numbers, so staff need a way to bring
every in-flight parcel up to date on demand and watch it happen ("812 of
2,000"). The work runs in one API worker while another may answer the
progress poll, so the progress is kept in the database.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pathao_sync_runs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "started_by",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("changed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "failures",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "heartbeat_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_pathao_sync_runs_store_id_id", "pathao_sync_runs", ["store_id", "id"]
    )


def downgrade() -> None:
    op.drop_index("ix_pathao_sync_runs_store_id_id", table_name="pathao_sync_runs")
    op.drop_table("pathao_sync_runs")
