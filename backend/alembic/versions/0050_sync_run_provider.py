"""pathao_sync_runs.provider: full syncs for Carrybee too

Revision ID: 0050
Revises: 0049
Create Date: 2026-10-26

Carrybee's webhooks can be lost, and its hourly poll only asks about parcels
that went quiet for hours, so staff want the same on-demand "Sync all" they
have for Pathao. Runs are now per (store, courier): the two couriers are
separate APIs, so a Carrybee run and a Pathao run may go side by side. Every
existing run was a Pathao one.
"""
from alembic import op
import sqlalchemy as sa

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pathao_sync_runs", sa.Column("provider", sa.String(20), nullable=True))
    op.execute("UPDATE pathao_sync_runs SET provider = 'pathao' WHERE provider IS NULL")
    op.alter_column("pathao_sync_runs", "provider", nullable=False)
    op.drop_index("ix_pathao_sync_runs_store_id_id", table_name="pathao_sync_runs")
    op.create_index(
        "ix_pathao_sync_runs_store_id_provider_id",
        "pathao_sync_runs",
        ["store_id", "provider", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_pathao_sync_runs_store_id_provider_id", table_name="pathao_sync_runs")
    op.create_index(
        "ix_pathao_sync_runs_store_id_id", "pathao_sync_runs", ["store_id", "id"]
    )
    op.drop_column("pathao_sync_runs", "provider")
