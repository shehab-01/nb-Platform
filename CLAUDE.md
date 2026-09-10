# nbPlatform

Multi-store e-commerce platform: one Next.js app serving any number of
storefronts plus a central admin, one FastAPI backend, one Postgres. Forked
from the single-store natureBazar app, which is live at naturebazar.shop and
**frozen** — never touch that repo or deployment from here. Its data will be
imported later as one tenant.

Read `docs/DESIGN-V2.md` (target design), `docs/PLAN.md` (phases and where we
are), `docs/ARCHITECTURE-V1.md` (what we inherited), `DEV.md` (running it),
`docs/DEPLOY.md` (production next to v1).

## Hard rules

- **Never delete, rename or edit an existing Alembic migration. Always add a
  new one.** Migrations that add `store_id` use add-nullable → backfill →
  NOT NULL, in that order.
- Every tenant-scoped table has `store_id`; every tenant index starts with
  `store_id`. Nothing tenant-scoped is ever queried without a store filter.
- The store is resolved from the hostname, on the server, from the database
  via an in-process TTL cache. `src/proxy.ts` must never do network I/O.
  Clients never name a store id for storefront requests; the admin names one
  via `X-Admin-Store` and the API checks membership.
- Staff identity is platform-wide (Google at the admin domain); store access
  is a `store_users` membership with role owner/manager/staff, checked by
  `api/tenancy.py`. Emails in `SUPER_ADMIN_EMAILS` are always super admin.
  New permissions go in `PERMISSIONS` there and its mirror in
  `components/admin/auth-context.tsx`.
- Runtime configuration, not build-time: there are no `NEXT_PUBLIC_*`
  variables. The storefront layout serialises the store's public config
  into `<script id="nb-store">`; `lib/store-public.ts` reads it. Services
  take a per-store `MetaConfig` / `PathaoConfig` from
  `stores.load_integrations()`, never `settings.*`. Per-store secrets live in
  `store_settings.*_enc`, encrypted by `api/crypto.py` under
  `APP_ENCRYPTION_KEY`, and the API returns only set-flags and a 4-char hint.
  Never add an endpoint or log line that emits a decrypted value.
- Templates are code: self-contained component sets under
  `frontend/src/templates/<name>/`, registered in `templates/index.ts` +
  `templates/catalog.ts` and in the API's `TEMPLATES`, picked per store by
  `store.template`. The admin never creates templates. Shared code must not
  grow per-template branches, and no page may bundle every template's JS.
- Prices, order totals and event ids are decided server-side. Client-sent
  totals are never trusted (unchanged from v1).
- Production: OpenLiteSpeed in front, `CLIENT_IP_HEADER=x-forwarded-for`,
  containers bound to 127.0.0.1, `WEB_PORT=8090`, `API_PORT=8001`, compose
  project `nbplatform`. Same ports locally so v1 (`../natureBazar`, 8085/8000)
  and v2 coexist.
- `DEV_LOGIN_EMAIL`, `DEV_STORE_FALLBACK` and `FRAUDBD_SANDBOX` are
  development switches and must be empty in production. Live Meta or Pathao credentials never go in
  the dev `.env`.
- Ask before anything irreversible (dropping data, cutover, changing a
  migration's meaning). Do not push or deploy unless asked.

## Layout

```
backend/   FastAPI. api/models.py, api/routers/*, api/services/* (meta_capi,
           pathao), api/stores.py (host → store), api/tenancy.py (memberships,
           X-Admin-Store), alembic/versions (0001–0024), scripts/seed_dev.py,
           tests/ (pytest, no DB)
frontend/  Next.js 16 App Router. src/proxy.ts (host routing), src/lib/store.ts
           (server-side store config), src/lib/admin-store.ts (+ lib/http.ts:
           X-Admin-Store), src/app/page.tsx (storefront root), src/templates/
           (registry; classic/ is template #1), src/app/admin/** (staff app),
           src/lib/*.test.ts (vitest)
compose.yaml, .env(.example), DEV.md, docs/
```

## Conventions

- Python: type-annotated, async SQLAlchemy 2.0, pydantic schemas in
  `api/schemas.py`, routers thin, logic in modules. Comments explain *why*.
- TypeScript: server components fetch the API directly via `API_URL` and must
  forward `storeHeaders()`; browser code calls same-origin `/api/*`. Storefront
  bundles import only `lib/storefront-api.ts`, `lib/tracking.ts`,
  `lib/products.ts` — never `lib/api.ts` (admin).
- Frontend maps API snake_case to camelCase at the `lib/api.ts` boundary.
- Bangla copy on the storefront, English in the admin.
- One migration per logical change, numbered `NNNN_short_name.py`, with a
  docstring saying why.

## Run and test

```bash
docker compose up -d --build && docker compose exec api python -m scripts.seed_dev
cd backend && .venv/bin/python -m pytest tests -q          # after: python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cd frontend && npm test && npx tsc --noEmit && npm run lint && npm run build
```

Dev URLs (via SSH tunnel + /etc/hosts, see DEV.md): http://admin.nb.local:8090,
http://store1.nb.local:8090, http://store2.nb.local:8090,
http://localhost:8090/?__store=store1.
