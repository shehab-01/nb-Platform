"""courier_accounts: Pathao / Carrybee merchant accounts, picked per store

Revision ID: 0053
Revises: 0052
Create Date: 2026-10-26

Several of our stores can book through one Pathao or Carrybee merchant
account, and a merchant account has exactly one webhook URL. Keeping the
credentials on each store (0048, 0051) meant typing them twice and getting
two webhook URLs and secrets the courier could never both call; 0052's
store-to-store links patched that, but the account still lived inside
whichever store held it.

An account is now its own row, managed by super admins on Settings →
Courier: credentials, the webhook's URL token, secret and integration
header, and Pathao's login token (one login per account, not per store).
Each store picks one per courier (store_settings.*_courier_account_id) and
keeps its own switch and parcel defaults (pickup store, weight, type).

Accounts are platform-level, like users: they belong to no single store, so
they carry no store_id. Nothing tenant-scoped is read through one without a
store filter — a webhook event is matched only among the parcels of the
stores that use the account.

Backfill: every store with its own credentials yields an account; stores
holding the same credentials (Pathao: client id and email; Carrybee: client
id) share one. Its webhook token and secret come from the store that had a
secret saved (else the lowest store id), so the URL already pasted into the
courier's panel keeps working; the other stores' old tokens are still
accepted (api.routers.webhooks). Stores linked by 0052 get their source
store's account. The old per-store columns stay, unread, so nothing is
dropped.
"""
import secrets

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None

LABELS = {"pathao": "Pathao", "carrybee": "Carrybee"}


def upgrade() -> None:
    op.create_table(
        "courier_accounts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("courier", sa.String(20), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("client_id", sa.String(120), nullable=False, server_default=""),
        sa.Column("client_secret_enc", sa.LargeBinary(), nullable=True),
        # Pathao's merchant login.
        sa.Column("username", sa.String(255), nullable=False, server_default=""),
        sa.Column("password_enc", sa.LargeBinary(), nullable=True),
        # Carrybee's third static header.
        sa.Column("client_context_enc", sa.LargeBinary(), nullable=True),
        sa.Column("webhook_token", sa.String(64), nullable=False),
        sa.Column("webhook_secret_enc", sa.LargeBinary(), nullable=True),
        sa.Column("integration_header", sa.String(100), nullable=False, server_default=""),
        # Pathao's OAuth token, shared by every store on the account.
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("courier IN ('pathao', 'carrybee')", name="ck_courier_accounts_courier"),
    )
    op.create_index(
        "ix_courier_accounts_webhook_token", "courier_accounts", ["webhook_token"], unique=True
    )
    for courier in ("pathao", "carrybee"):
        op.add_column(
            "store_settings",
            sa.Column(
                f"{courier}_courier_account_id",
                sa.BigInteger(),
                sa.ForeignKey("courier_accounts.id", ondelete="RESTRICT"),
                nullable=True,
            ),
        )
        op.create_index(
            f"ix_store_settings_{courier}_courier_account_id",
            "store_settings",
            [f"{courier}_courier_account_id"],
        )

    bind = op.get_bind()
    _backfill(bind, "pathao")
    _backfill(bind, "carrybee")


def _backfill(bind, courier: str) -> None:
    if courier == "pathao":
        extra = (
            "s.pathao_email AS username, s.pathao_password_enc AS password_enc, "
            "NULL::bytea AS client_context_enc"
        )
    else:
        extra = (
            "'' AS username, NULL::bytea AS password_enc, "
            "s.carrybee_client_context_enc AS client_context_enc"
        )
    rows = bind.execute(
        sa.text(
            f"""
            SELECT s.store_id, st.name AS store_name,
                   s.{courier}_client_id AS client_id,
                   s.{courier}_client_secret_enc AS client_secret_enc,
                   {extra},
                   s.{courier}_webhook_token AS webhook_token,
                   s.{courier}_webhook_secret_enc AS webhook_secret_enc,
                   s.{courier}_integration_header AS integration_header
            FROM store_settings s JOIN stores st ON st.id = s.store_id
            WHERE s.{courier}_client_id <> '' AND s.{courier}_account_store_id IS NULL
            ORDER BY s.store_id
            """
        )
    ).mappings().all()

    groups: dict[tuple, list] = {}
    for row in rows:
        key = (
            (row["client_id"], (row["username"] or "").lower())
            if courier == "pathao"
            else (row["client_id"],)
        )
        groups.setdefault(key, []).append(row)

    account_of_store: dict[int, int] = {}
    for members in groups.values():
        # The webhook already set up wins, so its URL keeps working.
        primary = next((m for m in members if m["webhook_secret_enc"] is not None), members[0])
        account_id = bind.execute(
            sa.text(
                """
                INSERT INTO courier_accounts
                    (courier, name, client_id, client_secret_enc, username, password_enc,
                     client_context_enc, webhook_token, webhook_secret_enc, integration_header)
                VALUES
                    (:courier, :name, :client_id, :client_secret_enc, :username, :password_enc,
                     :client_context_enc, :webhook_token, :webhook_secret_enc, :integration_header)
                RETURNING id
                """
            ).bindparams(
                sa.bindparam("client_secret_enc", type_=postgresql.BYTEA),
                sa.bindparam("password_enc", type_=postgresql.BYTEA),
                sa.bindparam("client_context_enc", type_=postgresql.BYTEA),
                sa.bindparam("webhook_secret_enc", type_=postgresql.BYTEA),
            ),
            {
                "courier": courier,
                "name": f"{primary['store_name']} {LABELS[courier]}",
                "client_id": primary["client_id"],
                "client_secret_enc": primary["client_secret_enc"],
                "username": primary["username"] or "",
                "password_enc": primary["password_enc"],
                "client_context_enc": primary["client_context_enc"],
                "webhook_token": primary["webhook_token"] or secrets.token_urlsafe(24),
                "webhook_secret_enc": primary["webhook_secret_enc"],
                "integration_header": primary["integration_header"] or "",
            },
        ).scalar_one()
        for member in members:
            account_of_store[member["store_id"]] = account_id

    # 0052's links: the linked store takes its source store's account.
    linked = bind.execute(
        sa.text(
            f"SELECT store_id, {courier}_account_store_id AS source FROM store_settings "
            f"WHERE {courier}_account_store_id IS NOT NULL"
        )
    ).mappings().all()
    for row in linked:
        if row["source"] in account_of_store:
            account_of_store[row["store_id"]] = account_of_store[row["source"]]

    for store_id, account_id in account_of_store.items():
        bind.execute(
            sa.text(
                f"UPDATE store_settings SET {courier}_courier_account_id = :account "
                "WHERE store_id = :store"
            ),
            {"account": account_id, "store": store_id},
        )


def downgrade() -> None:
    for courier in ("pathao", "carrybee"):
        op.drop_index(
            f"ix_store_settings_{courier}_courier_account_id", table_name="store_settings"
        )
        op.drop_column("store_settings", f"{courier}_courier_account_id")
    op.drop_index("ix_courier_accounts_webhook_token", table_name="courier_accounts")
    op.drop_table("courier_accounts")
