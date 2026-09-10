# Deploying nbPlatform to production (next to v1)

v1 (natureBazar) keeps running untouched: compose project `naturebazar`, ports
8085/8000. v2 is a second compose project on the same host: `nbplatform`,
web on `127.0.0.1:8090`, API on `127.0.0.1:8001`, Postgres not published.
OpenLiteSpeed terminates TLS and proxies each hostname to 127.0.0.1:8090.

## 1. First-time deploy

```bash
# on the server
mkdir -p /root/projects && cd /root/projects
git clone <repo-url> nbPlatform && cd nbPlatform
git checkout v2.0.0-rc1            # or the tag you are deploying
cp .env.example .env
```

Edit `.env`. Every value below marked TODO must be set; the rest keep the
example's value.

| variable | value |
|---|---|
| `POSTGRES_PASSWORD` | TODO — `openssl rand -hex 24` |
| `SESSION_SECRET` | TODO — `openssl rand -hex 32` |
| `APP_ENCRYPTION_KEY` | TODO — `docker run --rm python:3.12-slim sh -c "pip -q install cryptography && python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"`. **Back it up with `.env`**: without it every stored CAPI token, Pathao password and FraudBD key is unreadable. |
| `ADMIN_HOST` | TODO — `admin.naturebazar.bd` |
| `SUPER_ADMIN_EMAILS` | TODO — your Google address(es), comma-separated; always super admin |
| `GOOGLE_CLIENT_ID` | TODO — the OAuth client id (see §4) |
| `COOKIE_SECURE` | `true` |
| `CLIENT_IP_HEADER` | `x-forwarded-for` |
| `PATHAO_BASE_URL` | `https://api-hermes.pathao.com` when parcels go live; sandbox until then |
| `API_PORT` / `WEB_PORT` | `8001` / `8090` |
| `UVICORN_WORKERS` | `2` |
| `GTM_ID` | optional, else empty |
| `DEV_LOGIN_EMAIL`, `DEV_STORE_FALLBACK`, `DEV_STORE_HOSTS`, `FRAUDBD_SANDBOX`, `SHOW_LEGACY_LANDING` | **empty** |

Per-store values (Meta pixel and CAPI token, Pathao credentials, FraudBD key,
pictures, order prefix) are entered in the admin after the store exists —
never in `.env`.

```bash
docker compose up -d --build
docker compose ps                                   # db healthy, api, web up
docker compose logs api | grep -c "Running upgrade" # migrations ran
curl -s http://127.0.0.1:8001/health                # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: admin.naturebazar.bd" http://127.0.0.1:8090/admin/login   # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: nothing.example" http://127.0.0.1:8090/               # 404
```

The API runs `alembic upgrade head` on every start. Never run
`scripts/seed_dev.py` here: it refuses unless the dev switches are on, and
`--force` would create demo stores.

## 2. OpenLiteSpeed

One virtual host per hostname (or one vhost listing the store domains as
aliases), each with a certificate, proxying to the web container. What matters:

- upstream `http://127.0.0.1:8090`;
- **the original `Host` header must reach the upstream unchanged** — it is
  how the store is chosen;
- `X-Forwarded-For` must be added (OLS does by default) — it is the client
  address for rate limiting;
- HTTP redirected to HTTPS; no caching of HTML.

`httpd_config.conf` / vhost conf snippet (WebAdmin: Virtual Hosts → External
App + Context):

```
extprocessor nbplatform_web {
  type                    proxy
  address                 127.0.0.1:8090
  maxConns                100
  pcKeepAliveTimeout      60
  initTimeout             60
  retryTimeout            0
  respBuffer              0
}

# in the vhost (one per hostname; same block for admin.naturebazar.bd and
# store.naturebazar.bd)
context / {
  type                    proxy
  handler                 nbplatform_web
  addDefaultCharset       off
}
rewrite {
  enable                  1
  rules                   <<<END_rules
RewriteCond %{HTTPS} !on
RewriteRule ^(.*)$ https://%{HTTP_HOST}$1 [R=301,L]
  END_rules
}
```

OLS proxies keep the client's `Host` header by default (there is no
"ProxyPreserveHost" toggle to set). If a vhost is ever configured with a
rewritten Host, the storefront answers 404 and the admin shows a store page —
that is the symptom to look for. `X-Forwarded-Proto` is not read by the app;
HTTPS is assumed via `COOKIE_SECURE=true`.

After the vhosts are live, sign in and open Admin → System: the Request tile
must show the client address as visible. If it says per-IP limiting is off,
`X-Forwarded-For` is not arriving.

## 3. DNS

`A` records for `admin.naturebazar.bd` and every store domain (first:
`store.naturebazar.bd`) pointing at the server. Certificates for each, or a
wildcard `*.naturebazar.bd` if stores stay under that zone.

## 4. Google sign-in

The admin uses Google Identity Services (the button renders an ID token; there
is no OAuth redirect flow), so the OAuth client needs only:

- **Authorised JavaScript origins**: `https://admin.naturebazar.bd`
- **Authorised redirect URIs**: none required.

Cloud Console → APIs & Services → Credentials → the OAuth 2.0 Client ID → add
the origin. Put the client id in `.env` as `GOOGLE_CLIENT_ID` (the client
secret is not used) and `docker compose up -d --force-recreate api`.

Your first sign-in with an address from `SUPER_ADMIN_EMAILS` creates the super
admin and lands on Platform → Stores. Everyone else who signs in is pending
until a super admin approves them and assigns a store.

## 5. First store

1. Platform → Stores → New store: domain `store.naturebazar.bd`, name, order
   prefix, template, pictures.
2. Switch to it → Settings: Pixel ID, CAPI token, test event code; Pathao
   client id/secret/email/password → **Test connection** → pick the store id;
   item type, weight; FraudBD key.
3. Products: add and activate.
4. Users: approve staff, assign to the store with a role.
5. Verify Meta with the test event code from the live domain (browser + server
   pairs marked deduplicated in Events Manager), then clear the code. Book
   one sandbox Pathao parcel, then switch `PATHAO_BASE_URL` to live.

Adding a domain later: Admin → Stores → Edit, or from the server:

```bash
scripts/add-store-domain.sh <store-slug> <hostname> [--primary]
```

(uses the compose `db` service; the change is live within ~30 s).

## 6. Routine deploy

```bash
cd /root/projects/nbPlatform
git fetch --tags && git checkout <new-tag>
docker compose up -d --build            # runs new migrations on api start
docker compose ps && curl -s http://127.0.0.1:8001/health
```

Runtime-only `.env` changes: `docker compose up -d --force-recreate api web`.
Logs: `docker compose logs -f api web`. Admin → System shows recent warnings,
traffic and per-store integration flags.

## 7. Rollback

```bash
git checkout <previous-tag>
docker compose up -d --build
```

Migrations are additive and never edited, so an older image runs against a
newer schema (extra tables/columns are ignored). Only downgrade the schema if a
release note says so:

```bash
docker compose exec api alembic downgrade <revision>
```

## 8. Backups

- Volumes `nbplatform_postgres-data` (database) and `nbplatform_media`
  (product and store pictures), plus `.env` (the encryption key).
- `docker compose exec -T db pg_dump -U nbplatform nbplatform | gzip > nbplatform-$(date +%F).sql.gz`

## 9. Caches to know about

Store, domain and settings changes reach every API worker within ~30 s, and
the web app caches store config for another ~30 s. A new domain, a pixel id
or a deactivated store is therefore live within about a minute.

## Not in this release

Ad attribution capture, owner-managed store staff, the v1 data import (v1
stays live and separate). See `PLAN.md`.
