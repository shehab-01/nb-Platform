"""store_users.crm_access: who may open a store's CRM

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-08

The CRM (expenses, and what follows) is no longer every owner's: a super
admin picks who may open it, per store, from the Users page. The flag sits
on the membership, so CRM access can only ever be given in a store the
person already belongs to, and removing them from the store removes it.
Super admins have no memberships and always have access. Nobody starts
with it: nullable → backfill false → NOT NULL.
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("store_users", sa.Column("crm_access", sa.Boolean(), nullable=True))
    op.execute("UPDATE store_users SET crm_access = false WHERE crm_access IS NULL")
    op.alter_column(
        "store_users",
        "crm_access",
        nullable=False,
        server_default=sa.false(),
    )


def downgrade() -> None:
    op.drop_column("store_users", "crm_access")
