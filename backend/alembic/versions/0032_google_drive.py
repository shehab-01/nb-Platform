"""Google Drive: the connected account, store folders, and expense proofs

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-09

Expense proofs (receipts, payment screenshots) are kept in one Google Drive
the platform owns, not on this server. drive_connection holds that account —
a single row, refresh token encrypted under APP_ENCRYPTION_KEY like the
per-store secrets. drive_folders remembers each store's folders there
(nbPlatform / store / Expenses / day) by store id, so they are found once and
survive a store rename. expense_proofs points each proof at its Drive file.
All new tables; tenant ones carry store_id first in every index.
"""
from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drive_connection",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("refresh_token_enc", sa.LargeBinary(), nullable=False),
        sa.Column("account_email", sa.String(255), nullable=True),
        sa.Column("root_folder_id", sa.String(100), nullable=True),
        sa.Column(
            "connected_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "connected_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "drive_folders",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("path", sa.String(200), nullable=False),
        sa.Column("folder_id", sa.String(100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_drive_folders_store_path", "drive_folders", ["store_id", "path"], unique=True
    )

    op.create_table(
        "expense_proofs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "expense_id",
            sa.BigInteger(),
            sa.ForeignKey("expenses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("drive_file_id", sa.String(100), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column(
            "created_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_expense_proofs_store_expense", "expense_proofs", ["store_id", "expense_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_expense_proofs_store_expense", table_name="expense_proofs")
    op.drop_table("expense_proofs")
    op.drop_index("ix_drive_folders_store_path", table_name="drive_folders")
    op.drop_table("drive_folders")
    op.drop_table("drive_connection")
