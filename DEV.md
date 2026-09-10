# Local development

The stack runs on this home server in Docker; you look at it from a Mac over
an SSH tunnel. Nothing here touches the v1 checkout in `../natureBazar` or
production.

## Ports and names

| what | where |
|---|---|
| web (Next.js) | `127.0.0.1:8090` on the server (`WEB_PORT`) |
| api (FastAPI) | `127.0.0.1:8001` on the server (`API_PORT`), also proxied at `/api` and `/media` by the web app |
| db | internal to the compose network |
| compose project | `nbplatform` (volumes `nbplatform_postgres-data`, `nbplatform_media`) |

v1 on the same machine uses project `naturebazar`, ports 8085/8000. Never run
compose commands for this repo from that directory or vice versa.

## First run (on the server)

```bash
cd ~/projects/nbPlatform
# .env already exists for this checkout; a fresh clone copies .env.example
docker compose up -d --build          # builds api + web, runs alembic upgrade head
docker compose exec api python -m scripts.seed_dev
docker compose ps
```

The seed is idempotent. It creates:

- super admin `DEV_LOGIN_EMAIL` (from `.env`), active, and an owner of
  both demo stores so the switcher has something to switch,
- store `store1` "Store One" at `store1.nb.local` (green theme),
- store `store2` "Store Two" at `store2.nb.local` (rust theme, template
  "Bazar Campaign"),
- a demo product per store ("Store One Demo Honey", "Store Two Demo Honey").

Migration 0011 seeds v1's product and migration 0020 needs a store to park it
on, so on a fresh database a store called "default" appears for a moment. The
seed deletes it (and that product) — it has no domain and no storefront, and
production never creates it because v2 starts with an empty catalogue.

`.env` also carries `APP_ENCRYPTION_KEY`, which encrypts the per-store
secrets entered on the Stores pages. A fresh clone must generate its own
(command in `.env.example`); losing it means re-entering every secret.

## Reach it from the Mac

1. Hostnames. Add one line to `/etc/hosts` on the Mac:

   ```bash
   sudo sh -c 'echo "127.0.0.1 admin.nb.local store1.nb.local store2.nb.local" >> /etc/hosts'
   ```

   (macOS treats `.local` as mDNS, which can add a second of delay on first
   lookup; `/etc/hosts` still wins. If it annoys you, use `nb.test` names
   instead and set `DEV_STORE_HOSTS` + `ADMIN_HOST` in `.env` to match.)

2. Tunnel. Keep this terminal open:

   ```bash
   ssh -N -L 8090:127.0.0.1:8090 shehab@shehabserver
   # add the API docs too if you want them:
   ssh -N -L 8090:127.0.0.1:8090 -L 8001:127.0.0.1:8001 shehab@shehabserver
   ```

   Replace `shehabserver` with however you normally reach this box (its LAN
   address was 10.0.7.1 when this was written). The browser sends
   `Host: admin.nb.local:8090` through the tunnel unchanged, which is all the
   routing needs.

3. Open:

   | URL | what |
   |---|---|
   | http://admin.nb.local:8090 | admin (root = dashboard; `/admin/...` also works) |
   | http://store1.nb.local:8090 | Store One |
   | http://store2.nb.local:8090 | Store Two |
   | http://localhost:8090 | "no store here" page listing the stores |
   | http://localhost:8090/?__store=store1 | Store One without hostnames (dev fallback, remembered in a `__store` cookie) |
   | http://localhost:8001/docs | API docs (second tunnel) |

Sign in at the admin with **Dev sign-in (local only)**. The sidebar header
is the store switcher; **Platform → Stores / Users** is where stores are
created and people are assigned to them. To try a non-admin view, create a
second user via Users (or remove super admin from the dev account, then add
it back with the dev sign-in, which re-grants owner on every store). Google sign-in is off
in dev: Google refuses `.local` OAuth origins, and `GOOGLE_CLIENT_ID` is
blank in the dev `.env`.

## How host routing works in dev

`frontend/src/proxy.ts` classifies the `Host` header: `ADMIN_HOST`
(`admin.nb.local`) is the admin, everything else is a storefront. It stamps
`X-Store-Host` on the request; the API resolves that hostname in
`store_domains` through a 30 s in-process cache. With `DEV_STORE_FALLBACK=1`
(dev `.env` only) `?__store=<slug>` sets `X-Store-Slug` instead. Details in
`docs/DESIGN-V2.md` §2.

## Everyday commands

```bash
docker compose up -d --build                 # after code changes
docker compose up -d --force-recreate web    # after changing runtime env only
docker compose logs -f web api
docker compose exec api python -m scripts.seed_dev
docker compose exec db psql -U nbplatform -d nbplatform
docker compose down                          # keeps volumes
docker compose down -v                       # DROPS the dev database
```

## Tests

```bash
# backend (no database needed)
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q

# frontend
cd frontend && npm ci && npm test && npx tsc --noEmit && npm run lint && npm run build
```

## Hot reload without Docker (optional)

```bash
# API against the compose database
docker compose stop api
cd backend && DATABASE_URL=postgresql://nbplatform:<pw>@localhost:5432/nbplatform \
  DEV_LOGIN_EMAIL=you@example.com DEV_STORE_FALLBACK=1 \
  .venv/bin/uvicorn main:app --reload --port 8001
# (compose's db is not published; add "127.0.0.1:5433:5432" under db.ports locally if you need this)

# web against the API
cd frontend && API_URL=http://localhost:8001 ADMIN_HOST=admin.nb.local DEV_STORE_FALLBACK=1 npm run dev -- -p 8090
```

## Resetting

```bash
docker compose down -v && docker compose up -d --build && \
  docker compose exec api python -m scripts.seed_dev
```
