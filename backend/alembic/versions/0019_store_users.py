"""store_users: which platform users may work in which store, and as what

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-10

Staff sign in once, platform-wide (users). Access to a store is a membership
row here with a per-store role (owner, manager, staff — see api.tenancy).
Super admins (users.role) need no rows: they see every store. The users.status
enum is unchanged: "suspended" is what the admin now labels "Disabled".
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "store_users",
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Plain string, validated by the API, so roles can evolve without an
        # enum migration (same choice as orders.status).
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # "Which stores may this user see" is the login-time query.
    op.create_index("ix_store_users_user_id", "store_users", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_store_users_user_id", table_name="store_users")
    op.drop_table("store_users")
