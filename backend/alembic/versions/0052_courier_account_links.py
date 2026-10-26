"""store_settings.*_account_store_id: stores sharing one courier account

Revision ID: 0052
Revises: 0051
Create Date: 2026-10-26

A courier merchant account has one webhook URL, and our URL names one store.
Two of our stores booking through the same Pathao or Carrybee account would
otherwise each keep their own copy of its credentials and webhook secret —
and only one store's URL can be in the courier's panel, so the other store's
events were dropped as unknown parcels.

Now a store can point at another store's account instead (set by a super
admin). Credentials, webhook token, secret and integration header are then
read from that store's row; the switch and parcel defaults (pickup store,
weight, type) stay the store's own. Events arriving at the account's URL are
matched against the parcels of every store on it. Nothing to backfill.
"""
from alembic import op
import sqlalchemy as sa

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for courier in ("pathao", "carrybee"):
        op.add_column(
            "store_settings",
            sa.Column(
                f"{courier}_account_store_id",
                sa.BigInteger(),
                sa.ForeignKey("stores.id", ondelete="RESTRICT"),
                nullable=True,
            ),
        )
        op.create_index(
            f"ix_store_settings_{courier}_account_store_id",
            "store_settings",
            [f"{courier}_account_store_id"],
        )


def downgrade() -> None:
    for courier in ("pathao", "carrybee"):
        op.drop_index(f"ix_store_settings_{courier}_account_store_id", table_name="store_settings")
        op.drop_column("store_settings", f"{courier}_account_store_id")
