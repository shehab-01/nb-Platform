"""stores and store_domains: the tenant table for the multi-store platform,
and the hostnames that resolve to each store

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-10

Only the tenant itself and its domains land here. store_id on the existing
tables, encrypted per-store secrets and visit attribution each come in their
own later migration, so this one stays small enough to never need touching.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stores",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        # URL-safe handle used in the admin, in the dev ?__store= fallback and
        # in logs. Never shown to customers.
        sa.Column("slug", sa.String(40), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        # Which component set renders the storefront (see frontend templates).
        sa.Column("template", sa.String(40), nullable=False, server_default="classic"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="BDT"),
        # Colours and other presentational knobs the template reads. Free-form
        # on purpose: each template documents the keys it understands.
        sa.Column("theme", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("uq_stores_slug", "stores", ["slug"], unique=True)

    op.create_table(
        "store_domains",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "store_id",
            sa.BigInteger(),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Lowercase, no port, no trailing dot — normalised before it is stored
        # and before it is looked up (see api.stores.normalise_host).
        sa.Column("host", sa.String(253), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # The Host -> store lookup, one row per hostname across every store.
    op.create_index("uq_store_domains_host", "store_domains", ["host"], unique=True)
    op.create_index("ix_store_domains_store_id", "store_domains", ["store_id"])
    # One primary domain per store.
    op.create_index(
        "uq_store_domains_single_primary",
        "store_domains",
        ["store_id"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )


def downgrade() -> None:
    op.drop_index("uq_store_domains_single_primary", table_name="store_domains")
    op.drop_index("ix_store_domains_store_id", table_name="store_domains")
    op.drop_index("uq_store_domains_host", table_name="store_domains")
    op.drop_table("store_domains")
    op.drop_index("uq_stores_slug", table_name="stores")
    op.drop_table("stores")
