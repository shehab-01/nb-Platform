"""store_settings: on/off per courier, and Carrybee's credentials

Revision ID: 0048
Revises: 0047
Create Date: 2026-10-18

Each courier now has a switch on the store's Settings page. Off hides the
courier everywhere (no booking, no sync) but keeps its saved credentials, so
switching back on needs nothing re-typed. A store that already has complete
Pathao credentials keeps working: pathao_enabled is backfilled true for it.

Carrybee authenticates every call with three static values (client id,
secret and context); the secret and context are encrypted like every other
secret here. carrybee_store_id is Carrybee's pickup store the parcels are
booked from. The webhook token is the unguessable part of the URL Carrybee
posts status changes to, and names the store; the webhook secret is what
Carrybee sends back in its signature header so we can trust the call. The
integration header is the fixed value Carrybee's Webhook Integration page
says our answer to its one-off integration check must carry.
"""
from alembic import op
import sqlalchemy as sa

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "store_settings",
        sa.Column("pathao_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        """
        UPDATE store_settings SET pathao_enabled = true
        WHERE pathao_client_id <> ''
          AND pathao_client_secret_enc IS NOT NULL
          AND pathao_email <> ''
          AND pathao_password_enc IS NOT NULL
          AND pathao_store_id IS NOT NULL
        """
    )
    op.add_column(
        "store_settings",
        sa.Column("carrybee_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "store_settings",
        sa.Column("carrybee_client_id", sa.String(120), nullable=False, server_default=""),
    )
    op.add_column(
        "store_settings", sa.Column("carrybee_client_secret_enc", sa.LargeBinary(), nullable=True)
    )
    op.add_column(
        "store_settings", sa.Column("carrybee_client_context_enc", sa.LargeBinary(), nullable=True)
    )
    op.add_column(
        "store_settings",
        sa.Column("carrybee_store_id", sa.String(40), nullable=False, server_default=""),
    )
    op.add_column(
        "store_settings",
        sa.Column("carrybee_product_type", sa.SmallInteger(), nullable=False, server_default="1"),
    )
    op.add_column(
        "store_settings",
        sa.Column("carrybee_item_weight_g", sa.Integer(), nullable=False, server_default="500"),
    )
    op.add_column(
        "store_settings", sa.Column("carrybee_webhook_secret_enc", sa.LargeBinary(), nullable=True)
    )
    op.add_column(
        "store_settings", sa.Column("carrybee_webhook_token", sa.String(64), nullable=True)
    )
    # The value Carrybee's panel says the integration check must get back in
    # X-CB-Webhook-Integration-Header — not the secret, a value of its own.
    op.add_column(
        "store_settings",
        sa.Column("carrybee_integration_header", sa.String(100), nullable=False, server_default=""),
    )
    op.create_index(
        "ix_store_settings_carrybee_webhook_token",
        "store_settings",
        ["carrybee_webhook_token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_store_settings_carrybee_webhook_token", table_name="store_settings")
    for column in (
        "carrybee_integration_header",
        "carrybee_webhook_token",
        "carrybee_webhook_secret_enc",
        "carrybee_item_weight_g",
        "carrybee_product_type",
        "carrybee_store_id",
        "carrybee_client_context_enc",
        "carrybee_client_secret_enc",
        "carrybee_client_id",
        "carrybee_enabled",
        "pathao_enabled",
    ):
        op.drop_column("store_settings", column)
