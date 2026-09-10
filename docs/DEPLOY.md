# Deploying nbPlatform next to v1

v1 (natureBazar, compose project `naturebazar`, ports 8085/8000) keeps running
untouched. v2 is a second compose project on the same host: `nbplatform`,
ports 8090 (web) and 8001 (API), both bound to 127.0.0.1, fronted by
OpenLiteSpeed.

## 1. Server prerequisites

- Docker + compose v2 (already there for v1).
- DNS: `A` records for the admin domain (e.g. `admin.naturebazar.bd`) and for
  every store domain, pointing at this server.
- TLS certificates in OpenLiteSpeed for each of those hostnames (Let's Encrypt
  per vhost, or a wildcard where stores are subdomains).

## 2. Clone and configure

```bash
git clone <repo> ~/apps/nbPlatform && cd ~/apps/nbPlatform
cp .env.example .env
```

Fill `.env`:

| variable | production value |
|---|---|
| `POSTGRES_PASSWORD` | long random |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `APP_ENCRYPTION_KEY` | `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` — **back this up**; without it every stored secret is unreadable |
| `API_PORT` / `WEB_PORT` | `8001` / `8090` |
| `ADMIN_HOST` | the admin hostname, e.g. `admin.naturebazar.bd` |
| `FRONTEND_ORIGIN` | `https://<admin host>` (CORS is otherwise unused: everything is same-origin) |
| `SUPER_ADMIN_EMAILS` | your Google account(s); always super admin |
| `GOOGLE_CLIENT_ID` | the OAuth client; add `https://<admin host>` to its authorised JavaScript origins in Google Cloud Console |
| `COOKIE_SECURE` | `true` (HTTPS only) |
| `CLIENT_IP_HEADER` | `x-forwarded-for` |
| `PATHAO_BASE_URL` | `https://api-hermes.pathao.com` for live parcels |
| `GTM_ID` | optional |
| `DEV_LOGIN_EMAIL`, `DEV_STORE_FALLBACK`, `FRAUDBD_SANDBOX` | **empty** |
| `SHOW_LEGACY_LANDING` | empty |

Per-store values (Meta pixel + CAPI token, Pathao credentials, FraudBD key,
pictures) are entered in the admin after the store exists, not in `.env`.

## 3. Start

```bash
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8001/health
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: <admin host>" http://127.0.0.1:8090/admin/login
```

`api` runs `alembic upgrade head` on every start. **Do not run
`scripts/seed_dev.py` in production**: it creates demo stores. The first
super admin is created by signing in with Google using an address from
`SUPER_ADMIN_EMAILS`.

## 4. OpenLiteSpeed

One vhost per hostname (or one vhost with all hostnames as aliases), each
proxying to the web container. Requirements:

- Upstream `http://127.0.0.1:8090`.
- **Preserve the original `Host` header** (the proxy must not rewrite it to
  the upstream address): that header is how the store is chosen.
- Pass `X-Forwarded-For` (OLS does by default); the API reads the rightmost
  public address for rate limiting.
- HTTPS with a redirect from HTTP. Set `X-Forwarded-Proto: https` if the vhost
  can.
- No caching of HTML; static assets under `/_next/static/` may be cached.

Check from the server, then from a browser:

```bash
curl -s -H "Host: <store host>" http://127.0.0.1:8090/api/storefront/config
```

Then in the admin: System → Request shows whether the client address header
arrives; if "per-IP limiting is off", `X-Forwarded-For` is not reaching the
API.

## 5. First store

1. Sign in at `https://<admin host>` with Google.
2. Platform → Stores → New store: domain, name, prefix, template, pictures.
3. Switch to the store → Settings: Pixel ID, CAPI token, test event code;
   Pathao client id/secret/email/password, **Test connection**, pick the
   store id; item type, weight; FraudBD key.
4. Products: add and activate the product.
5. Users: approve staff and assign them to the store with a role.
6. Verify tracking with the Meta test event code from the live domain, then
   clear the code. Book one sandbox parcel before switching
   `PATHAO_BASE_URL` to live (that change is a `docker compose up -d
   --force-recreate api`).

## 6. Operations

- Backups: the `nbplatform_postgres-data` and `nbplatform_media` volumes,
  plus `.env` (the encryption key). `docker compose exec -T db pg_dump -U
  nbplatform nbplatform > backup.sql`.
- Redeploy: `git pull && docker compose up -d --build`.
- Runtime-only env changes: `docker compose up -d --force-recreate api web`.
- Logs: `docker compose logs -f api web`. Admin → System shows recent
  warnings, traffic, rate limiting and integration flags per store.
- Config caches: store/domain/settings changes propagate to every worker
  within ~30 s; the web app caches store config another ~30 s.

## Not yet done (see PLAN.md)

Ad attribution capture (Phase 5), owner-managed store staff, the v1 data
import (Phase 6; v1 stays live and separate for now).
