"""production_days.sent_at / sent_by_id: a production sent to Expenses

Revision ID: 0042
Revises: 0041
Create Date: 2026-10-13

A production no longer files its expenses on every save. Its "Send to
Expenses" button files them once — raw materials, cook salary and other
costs — and from then on the production cannot be changed, only deleted
(which deletes those expenses too). These columns say when that happened
and who did it; null means not sent yet. Existing days have not been sent.
"""
from alembic import op
import sqlalchemy as sa

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_days", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "production_days",
        sa.Column(
            "sent_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("production_days", "sent_by_id")
    op.drop_column("production_days", "sent_at")
