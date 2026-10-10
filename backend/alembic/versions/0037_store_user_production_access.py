"""store_users.production_access: who may record productions

Revision ID: 0037
Revises: 0036
Create Date: 2026-10-10

The Production pages get their own access, apart from the CRM's. Production
admins (PRODUCTION_ADMIN_EMAILS, and super admins) have full control and
choose, per store, who else may record new productions; that choice is this
flag on the membership, so it can only be given to someone already in the
store and goes when they leave it. Nobody starts with it, CRM users included:
nullable → backfill false → NOT NULL.
"""
from alembic import op
import sqlalchemy as sa

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("store_users", sa.Column("production_access", sa.Boolean(), nullable=True))
    op.execute("UPDATE store_users SET production_access = false WHERE production_access IS NULL")
    op.alter_column(
        "store_users",
        "production_access",
        nullable=False,
        server_default=sa.false(),
    )


def downgrade() -> None:
    op.drop_column("store_users", "production_access")
