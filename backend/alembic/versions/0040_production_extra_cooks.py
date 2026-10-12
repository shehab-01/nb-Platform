"""production_days.extra_cooks: cooks paid a different rate

Revision ID: 0040
Revises: 0039
Create Date: 2026-10-12

Not every cook earns the day's male or female rate. Those who do not are
recorded as extra lines, [{"label": "Head cook", "cooks": 1, "rate": 900}],
and their pay is added to the day's labour cost. Existing days have none:
nullable → backfill '[]' → NOT NULL.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_days",
        sa.Column("extra_cooks", postgresql.JSONB(), nullable=True),
    )
    op.execute("UPDATE production_days SET extra_cooks = '[]'::jsonb WHERE extra_cooks IS NULL")
    op.alter_column(
        "production_days",
        "extra_cooks",
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )


def downgrade() -> None:
    op.drop_column("production_days", "extra_cooks")
