"""production: the default raw materials in Bangla

Revision ID: 0036
Revises: 0035
Create Date: 2026-10-10

The bazar is written in Bangla, so the default raw materials 0035 gave every
store are renamed to their Bangla names. Only a row still carrying the
English default name is touched, and not where the store already has the
Bangla one (the name is unique per store). Units are stored as codes ("kg",
"L") and shown in Bangla by the admin, so they stay as they are.
"""
from alembic import op
import sqlalchemy as sa

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None

RENAMES = (
    ("Mustard oil", "সরিষার তেল"),
    ("Mustard seed", "সরিষা"),
    ("Fenugreek", "মেথি"),
    ("Garlic", "রসুন"),
    ("Green chili", "কাঁচা মরিচ"),
    ("Ginger", "আদা"),
    ("Salt", "লবণ"),
    ("Spice mix", "মশলা (মিক্স)"),
)

_RENAME = sa.text(
    """
    UPDATE production_items AS i SET name = :to
    WHERE i.name = :from
      AND NOT EXISTS (
        SELECT 1 FROM production_items o WHERE o.store_id = i.store_id AND o.name = :to
      )
    """
)


def upgrade() -> None:
    for english, bangla in RENAMES:
        op.execute(_RENAME.bindparams(**{"from": english, "to": bangla}))


def downgrade() -> None:
    for english, bangla in RENAMES:
        op.execute(_RENAME.bindparams(**{"from": bangla, "to": english}))
