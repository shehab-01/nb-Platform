"""order_items.stock_packets: the packets a line takes, fixed when it is ordered

Revision ID: 0058
Revises: 0057
Create Date: 2026-11-19

Stock (0057) worked out what an order in History takes from each line's
option *as it is now*: quantity × product_variants.stock_packets. That let a
later edit rewrite the past. Eco-Tine turned its 5-packet option into the
10-packet one and added a new 5-packet option, and every 5-packet order
placed before was then counted as 10 packets.

So each line now keeps the packets one of it held when it was ordered, the
same way it already keeps its name and price. Editing or reusing an option
afterwards changes new orders only.

Added nullable, filled from each line's option as it is today (at this
point the options are right: Eco-Tine's lines were moved to the right
option by hand before this ran, and every other store's options hold one
packet), with 1 for lines whose option is gone, then NOT NULL with 1 as the
default.
"""
from alembic import op
import sqlalchemy as sa

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("stock_packets", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE order_items oi
           SET stock_packets = v.stock_packets
          FROM product_variants v
         WHERE v.id = oi.variant_id
        """
    )
    op.execute("UPDATE order_items SET stock_packets = 1 WHERE stock_packets IS NULL")
    op.alter_column("order_items", "stock_packets", nullable=False, server_default="1")


def downgrade() -> None:
    op.drop_column("order_items", "stock_packets")
