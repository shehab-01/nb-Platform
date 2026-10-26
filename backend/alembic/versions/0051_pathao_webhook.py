"""store_settings: Pathao's status webhook

Revision ID: 0051
Revises: 0050
Create Date: 2026-10-26

Pathao can now post every status change to us, as Carrybee does, so a parcel's
status lands within seconds instead of on the next 15-minute poll. Same three
values as Carrybee's: the token is the unguessable part of the store's
webhook URL and names the store; the secret is what Pathao sends back in
X-PATHAO-Signature; the integration header is the fixed value Pathao's
Webhook Integration page says our answer to its check must carry in
X-Pathao-Merchant-Webhook-Integration-Secret.

Stores already using Pathao get their token here, so the URL shows on the
Settings page without anyone having to save first.
"""
import secrets

from alembic import op
import sqlalchemy as sa

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "store_settings", sa.Column("pathao_webhook_secret_enc", sa.LargeBinary(), nullable=True)
    )
    op.add_column(
        "store_settings", sa.Column("pathao_webhook_token", sa.String(64), nullable=True)
    )
    op.add_column(
        "store_settings",
        sa.Column("pathao_integration_header", sa.String(100), nullable=False, server_default=""),
    )
    op.create_index(
        "ix_store_settings_pathao_webhook_token",
        "store_settings",
        ["pathao_webhook_token"],
        unique=True,
    )
    bind = op.get_bind()
    store_ids = bind.execute(
        sa.text("SELECT store_id FROM store_settings WHERE pathao_enabled")
    ).scalars().all()
    for store_id in store_ids:
        bind.execute(
            sa.text(
                "UPDATE store_settings SET pathao_webhook_token = :token WHERE store_id = :id"
            ),
            {"token": secrets.token_urlsafe(24), "id": store_id},
        )


def downgrade() -> None:
    op.drop_index("ix_store_settings_pathao_webhook_token", table_name="store_settings")
    for column in (
        "pathao_integration_header",
        "pathao_webhook_token",
        "pathao_webhook_secret_enc",
    ):
        op.drop_column("store_settings", column)
