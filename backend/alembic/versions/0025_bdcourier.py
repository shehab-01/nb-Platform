"""Swap the courier-check provider from FraudBD to BDCourier

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-10

BDCourier uses its own API key, so it gets its own encrypted column rather
than reusing fraudbd_api_key_enc — that column is left in place (old data is
never dropped) but the app stops reading it. BDCourier's response also
carries a list of fraud reports per phone, which fraud_checks did not have a
place for before; couriers/total/success/cancel/success_rate keep the same
meaning and are reused unchanged. pathao_rating/pathao_risk are left in
place too: BDCourier does not return a rating, so the app stops writing them,
but old FraudBD rows keep theirs.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "store_settings", sa.Column("bdcourier_api_key_enc", sa.LargeBinary(), nullable=True)
    )
    op.add_column(
        "fraud_checks",
        sa.Column(
            "reports", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("fraud_checks", "reports")
    op.drop_column("store_settings", "bdcourier_api_key_enc")
