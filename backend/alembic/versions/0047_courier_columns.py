"""orders.courier_*: one set of booking columns for every courier

Revision ID: 0047
Revises: 0046
Create Date: 2026-10-18

Orders could only be booked with Pathao, so the booking lived in pathao_*
columns. Carrybee is the second courier, and a parcel is booked with exactly
one of them, so the booking columns become courier-neutral and a new
courier_provider says whose consignment it is. Renamed, not copied: nothing
is dropped, and every reader moves to the new names in the same release.

Every order already booked was booked with Pathao, so it is backfilled
"pathao"; unbooked orders stay null. courier_status_at is when the courier's
current status happened, by the courier's own clock: webhooks can arrive out
of order, and an older event must never overwrite a newer one.

The Pathao-only columns stay as they are: the delivery location in Pathao's
own city/zone/area ids and the parser's answer mean nothing to Carrybee.

The consignment index was platform-wide (it predates stores); it is replaced
by one led by store_id, which is how the webhook looks a parcel up.
"""
from alembic import op
import sqlalchemy as sa

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None

RENAMES = (
    ("pathao_consignment_id", "courier_consignment_id"),
    ("pathao_status", "courier_status"),
    ("pathao_delivery_fee", "courier_delivery_fee"),
    ("pathao_sent_at", "courier_sent_at"),
    ("pathao_checked_at", "courier_checked_at"),
)


def upgrade() -> None:
    for old, new in RENAMES:
        op.alter_column("orders", old, new_column_name=new)
    op.add_column("orders", sa.Column("courier_provider", sa.String(20), nullable=True))
    op.execute(
        "UPDATE orders SET courier_provider = 'pathao' "
        "WHERE courier_consignment_id IS NOT NULL"
    )
    op.add_column(
        "orders", sa.Column("courier_status_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.drop_index("ix_orders_pathao_consignment_id", table_name="orders")
    op.create_index(
        "ix_orders_store_courier_consignment",
        "orders",
        ["store_id", "courier_consignment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_orders_store_courier_consignment", table_name="orders")
    op.drop_column("orders", "courier_status_at")
    op.drop_column("orders", "courier_provider")
    for old, new in RENAMES:
        op.alter_column("orders", new, new_column_name=old)
    op.create_index(
        "ix_orders_pathao_consignment_id", "orders", ["pathao_consignment_id"]
    )
