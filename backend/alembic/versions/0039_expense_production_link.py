"""expenses.production_day_id / production_part: expenses a production makes

Revision ID: 0039
Revises: 0038
Create Date: 2026-10-12

Saving a production day now files its costs as expenses, one per part
(raw materials, cooks, gas, packaging, other costs) rather than one per bazar
line. These two columns say which day and which part an expense stands for,
so saving the day again updates the same expenses instead of adding more.
Both are null on an expense typed by hand. At most one expense per part per
day; the unique index starts with store_id like every tenant index.

ON DELETE SET NULL is only a backstop: deleting a production day removes its
expenses itself (api.routers.production), after checking none is approved.
"""
from alembic import op
import sqlalchemy as sa

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expenses",
        sa.Column(
            "production_day_id",
            sa.BigInteger(),
            sa.ForeignKey("production_days.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("expenses", sa.Column("production_part", sa.String(20), nullable=True))
    op.create_index(
        "ix_expenses_store_production",
        "expenses",
        ["store_id", "production_day_id", "production_part"],
        unique=True,
        postgresql_where=sa.text("production_day_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_expenses_store_production", table_name="expenses")
    op.drop_column("expenses", "production_part")
    op.drop_column("expenses", "production_day_id")
