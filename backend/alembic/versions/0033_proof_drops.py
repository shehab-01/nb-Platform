"""proof_drops: sending an expense proof from a phone via a QR code

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-09

Someone recording an expense on a PC often has the receipt on their phone.
The drawer shows a QR code for a one-time link (15 minutes, add-only); the
phone uploads to it, the pictures go straight to Google Drive, and the
drawer picks them up. proof_drops is the link (only a hash of its secret is
kept); proof_drop_files points at what arrived, until the expense is saved
or the link expires. New tables, store_id first in every tenant index.
"""
from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proof_drops",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # A token is looked up before its store is known, so this one index
    # cannot start with store_id; it is unique and holds only hashes.
    op.create_index("ix_proof_drops_token_hash", "proof_drops", ["token_hash"], unique=True)
    op.create_index("ix_proof_drops_store_expires", "proof_drops", ["store_id", "expires_at"])

    op.create_table(
        "proof_drop_files",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "drop_id",
            sa.BigInteger(),
            sa.ForeignKey("proof_drops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("drive_file_id", sa.String(100), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_proof_drop_files_store_drop", "proof_drop_files", ["store_id", "drop_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_proof_drop_files_store_drop", table_name="proof_drop_files")
    op.drop_table("proof_drop_files")
    op.drop_index("ix_proof_drops_store_expires", table_name="proof_drops")
    op.drop_index("ix_proof_drops_token_hash", table_name="proof_drops")
    op.drop_table("proof_drops")
