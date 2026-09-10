"""store_settings: per-store integration configuration, secrets encrypted

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-10

One row per store, created on first save. Columns ending in _enc hold Fernet
ciphertext (see api.crypto) under APP_ENCRYPTION_KEY; everything else is
plain. Typed columns rather than a key/value table so the admin form, the
validation and the services all agree on what exists.
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "store_settings",
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Meta. The pixel id is public (it is in the page source).
        sa.Column("meta_pixel_id", sa.String(40), nullable=False, server_default=""),
        sa.Column("meta_capi_token_enc", sa.LargeBinary(), nullable=True),
        sa.Column("meta_test_event_code", sa.String(40), nullable=False, server_default=""),
        # Pathao merchant API.
        sa.Column("pathao_client_id", sa.String(120), nullable=False, server_default=""),
        sa.Column("pathao_client_secret_enc", sa.LargeBinary(), nullable=True),
        sa.Column("pathao_email", sa.String(255), nullable=False, server_default=""),
        sa.Column("pathao_password_enc", sa.LargeBinary(), nullable=True),
        sa.Column("pathao_store_id", sa.Integer(), nullable=True),
        # Pathao item type: document, parcel or fragile.
        sa.Column("pathao_item_type", sa.String(20), nullable=False, server_default="parcel"),
        sa.Column(
            "pathao_parcel_weight_kg",
            sa.Numeric(4, 2),
            nullable=False,
            server_default="1",
        ),
        # FraudBD (customer risk lookup).
        sa.Column("fraudbd_api_key_enc", sa.LargeBinary(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("store_settings")
