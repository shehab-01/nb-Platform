"""stores.content: per-store overrides for a template's pictures and copy

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-10

JSONB keyed by the field names a template declares (frontend
templates/catalog.ts). Absent key = the template's default; an image value is
a path under the media root ("stores/<id>/<file>"). Kept on the stores row
because it is read on every storefront request together with the template.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column("content", postgresql.JSONB(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("stores", "content")
