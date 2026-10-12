"""expenses.status: pending until a super admin approves it

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-12

Every expense now carries a status, "pending" or "approved", and who
approved it and when. Only a super admin approves; anyone else editing an
approved expense puts it back to pending. The store starts its books afresh,
so every existing expense is pending too: nullable → backfill → NOT NULL.
"""
from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("expenses", sa.Column("status", sa.String(10), nullable=True))
    op.execute("UPDATE expenses SET status = 'pending' WHERE status IS NULL")
    op.alter_column(
        "expenses", "status", nullable=False, server_default=sa.text("'pending'")
    )
    op.add_column(
        "expenses",
        sa.Column(
            "approved_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "expenses", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("expenses", "approved_at")
    op.drop_column("expenses", "approved_by_id")
    op.drop_column("expenses", "status")
