# nbPlatform v2 design

One Next.js app, one FastAPI backend, one Postgres, any number of stores. The
store is resolved from the hostname on every request; everything tenant-scoped
carries `store_id`. This document is the target; `PLAN.md` is the order of
work; `ARCHITECTURE-V1.md` is what we started from.

## 1. Data model

### 1.1 Tenancy core (migration 0018, in place)

```
stores          id, slug (uq), name, template, currency, theme jsonb,
                is_active, created_at, updated_at
store_domains   id, store_id (fk cascade), host (uq, normalised), is_primary,
                created_at   -- one primary per store (partial unique)
```

`host` is stored lowercase, without port or trailing dot, and looked up the
same way (`api.stores.normalise_host`). Alias domains are simply more rows.
Redirect-alias-to-primary is a per-domain flag to add later if wanted; for
now every domain serves the store as-is.

### 1.2 Per-store settings and secrets (migration 0021, in place)

```
store_settings  store_id (pk, fk),
                meta_pixel_id text, meta_capi_token_enc bytea,
                meta_test_event_code text,
                pathao_client_id text, pathao_client_secret_enc bytea,
                pathao_email text, pathao_password_enc bytea,
                pathao_store_id int, pathao_item_type text default 'parcel',
                pathao_parcel_weight_kg numeric default 1,
                fraudbd_api_key_enc bytea,
                updated_at
```

Later additions (own migrations): `order_prefix`, `google_login_enabled`,
a Pathao sandbox flag (base URL stays global for now).

Typed columns rather than a generic key/value table: the admin form is typed,
validation is typed, and a wrong key cannot be misspelled into existence.
Secrets are the `*_enc` columns, encrypted with **Fernet** (`cryptography`)
using `APP_ENCRYPTION_KEY` from `.env`. Fernet gives authenticated encryption
plus a version byte; `MultiFernet([new, old])` handles key rotation without a
schema change (`APP_ENCRYPTION_KEY` becomes a comma list, first key encrypts,
all keys decrypt). Plaintext never leaves the API: the settings endpoint
returns `has_meta_capi_token: true` and last-4 hints, never the value. The
pixel id is not a secret (it is in the page source) and is stored plain.

A `StoreSettings` dataclass (decrypted, frozen) is what the services take.
It is loaded per store with the same TTL cache as host resolution, so no
request decrypts anything twice within the window.

### 1.3 store_id everywhere (Phases 1–4)

Added, one migration per table group, using the pattern *add nullable →
backfill → set NOT NULL → add indexes*. Backfill target on a non-empty
database is a store created by the migration itself only if rows exist and
no store does (the dev/prod fresh path has no rows, the import path sets
store_id explicitly).

| table | change |
|---|---|
| `products` | `store_id`; replace global `uq_products_single_active` with partial unique on `(store_id) WHERE is_active` |
| `product_variants` | no column (reached via product); index unchanged |
| `orders` | `store_id`; indexes become `(store_id, status, created_at)`, `(store_id, phone_key)`, `(store_id, created_at)`; `draft_key` stays globally unique (UUID) |
| `order_items`, `order_tags`, `order_events` | reached via order; `order_events` gets `store_id` too because the dashboard aggregates it directly: index `(store_id, actor_id, event_type)`, `(store_id, created_at)` |
| `visits` | `store_id` + attribution columns (1.4); index `(store_id, at)` |
| `meta_capi_failed_events` | `store_id` |
| `integration_tokens` | pk becomes `(store_id, provider)` |
| `traffic_minutes` | stays global (service health, not tenant data) |
| `users` | unchanged shape; `role` keeps `super_admin | staff` meaning *platform* super admin vs everyone else |
| `store_users` (new) | `store_id, user_id, role ∈ {manager, staff}`, pk `(store_id, user_id)` |

Every tenant index leads with `store_id`. The `store_id` column is
`BigInteger NOT NULL REFERENCES stores(id)` with `ON DELETE RESTRICT`: a store
with data is deactivated, never deleted.

### 1.4 Visit attribution (Phase 5)

On `visits` and copied onto `orders`:

```
utm_source, utm_medium, utm_campaign, utm_content, utm_term  varchar(100)
fb_campaign_id, fb_adset_id, fb_ad_id                          varchar(40)
fbclid                                                          varchar(255)
landing_path varchar(255), referrer varchar(500)
orders.visit_id bigint null (fk visits, SET NULL)
```

Capture: the inline pixel bootstrap already parses the URL synchronously
before anything else. It additionally writes a first-touch `nb_attr` cookie
(JSON, 90 days, only when absent, so the click that brought the visitor wins
over a later direct visit) and includes the same fields in the PageView POST
to `/api/track`, which writes them on the `visits` row. The order POST sends
`attribution` (the cookie contents) in its body; the API validates lengths
and copies it onto the order, and links `visit_id` when the PageView's visit
id is in the cookie. Ad ids come from URL params your ad URLs must carry:
`utm_*` plus `fb_campaign_id={{campaign.id}}&fb_adset_id={{adset.id}}&fb_ad_id={{ad.id}}`
(Meta dynamic URL parameters). `fbclid` alone identifies the click but not
the campaign, hence the explicit ids. Meta's `_fbc` cookie is unchanged.

## 2. Host → store resolution

### Next.js (`src/proxy.ts`, in place)

Runs on every non-static request, does no I/O:

1. `host = normaliseHost(Host)`. If `host == ADMIN_HOST` (runtime env): the
   request is the admin. Paths not under `/admin` are rewritten to
   `/admin<path>` so the admin lives at the root of its domain; `/api` and
   `/media` pass through.
2. Otherwise it is a storefront request. `/admin*` → 404. The proxy sets
   request header `X-Store-Host: <host>` (overwriting anything the client
   sent) and, with `DEV_STORE_FALLBACK=1`, `X-Store-Slug` from `?__store=` or
   the `__store` cookie.
3. Those request headers ride along into server components (`headers()`) and
   into the `/api/*` rewrite the browser's calls go through, so the API sees
   them on every request without the browser being able to choose them.

Server components call `getStore()` (`src/lib/store.ts`): reads the two
headers, asks the API `/api/storefront/config`, caches the answer per
host/slug in a module-level Map for 30 s. One process, one Map, no network on
a warm hit.

### FastAPI (`api/stores.py`, in place)

`resolve_request()` takes `X-Store-Host` (falling back to `X-Forwarded-Host`
and `Host`, which matter only when the API is called directly on 127.0.0.1)
and looks the hostname up in `store_domains` through an in-process TTL cache
(30 s, negative results cached too, bounded size). Because the API resolves
the *hostname* itself, the header is a hint about which domain the browser
used, not a claim of identity: an unknown hostname is a 404, and no request
can name a store id directly. `X-Store-Slug` is honoured only when
`DEV_STORE_FALLBACK=1`.

Verification beyond that is defence in depth and cheap: the API port is bound
to 127.0.0.1 and only the web container talks to it. If the API is ever
exposed more widely, add `INTERNAL_PROXY_SECRET` set by the proxy on every
forwarded request and required by the API.

Storefront endpoints depend on `current_store` (404 without one). Public
`POST /orders`, `/orders/draft`, `/track`, `/storefront/*` all become
store-scoped this way in Phases 1–3.

### Admin store scoping

The admin never uses the Host header for tenancy (it has one host). Instead:

- `GET /api/me/stores` lists the stores the user may see (all active stores
  for a super admin, `store_users` rows otherwise) — cached in the auth
  context.
- The store switcher (header dropdown) writes `nb_store=<id>` cookie and the
  admin client sends `X-Admin-Store: <id>` on every request.
- Dependency `admin_store(user, X-Admin-Store)` → `StoreConfig`, 403 unless
  super admin or a member. Every admin query filters on it. A super admin
  sees exactly one store at a time, as required; a "platform" area (stores
  CRUD, all users, system) is super-admin-only and unscoped.

## 3. Runtime per-store config on the storefront and the pixel

- `app/(store)/layout.tsx` (a route group so the admin stops sharing the
  pixel layout) calls `getStore()` and passes `store.publicConfig`
  (`{slug, name, currency, pixelId, gtmId, theme, template}`) down. The pixel
  bootstrap string is built **per request** from `store.pixelId`, replacing
  the module-level constant; empty id → no script.
- The same object is serialised once into `<script id="nb-store" type="application/json">`
  and read by `lib/tracking.ts` via `getStoreConfig()` instead of
  `process.env.NEXT_PUBLIC_*`. `PIXEL_ID`, `GTM_ID`, `CURRENCY` constants go
  away; the `Dockerfile` build args go away. `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
  is replaced by `/api/auth/providers` returning the client id (already
  returns enabled flags).
- On the API, `meta_capi.dispatch(event, settings: StoreSettings)` and
  `pathao.Client(settings)` replace reads of the global `settings.*`;
  `/api/track` and the order endpoint pass the resolved store's settings.
  Failed events carry `store_id` so resend uses the right token.

## 4. Template mechanism

Templates are **code, not data**. Each is a folder under
`frontend/src/templates/<id>/`, registered once in `templates/index.ts`
(components) and `templates/catalog.ts` (name, description, preview,
highlights), and mirrored in the API's `TEMPLATES` tuple so a store can only
be saved pointing at one that exists. The admin cannot create templates; it
picks one per store, and any number of stores may share one. A store row
holds only the template id. Adding a template is a developer task and a
deploy.

**Store creation** is three fields: domain, store name, template (slug
derived from the name). The store's integrations (Meta, Pathao, FraudBD)
and, later, its content live under that store's own **Settings**, reached
through the switcher and gated by the `settings` permission (owners and
super admins).

```
frontend/src/templates/
  index.ts            registry: { classic: () => import("./classic") }
  types.ts            TemplateModule = { Storefront, Closed, metadata }
  classic/
    index.ts          exports the three above
    storefront.tsx    today's landing.tsx, taking { store, listing }
    closed.tsx
    landing.css
```

`app/(store)/page.tsx` does `const tpl = await loadTemplate(store.template)`
and renders `<tpl.Storefront store listing/>`. The registry uses dynamic
`import()` per template, so the client bundle for a page contains only the
client components that template references; adding a template is a new folder
plus one registry line. Templates receive a typed `StorePublicConfig` and a
`StorefrontListing`; they must not import from `lib/api.ts` (admin), only
`lib/storefront-api.ts` and `lib/tracking.ts`. Theme colours reach the
template as CSS custom properties (`themeVars()`), which each template maps
onto its own variables. The admin's store form offers `Object.keys(registry)`
(served by a tiny `/api/templates` list mirrored on the API for validation).

### 4.1 Live preview and store content (decided 2026-09-10)

`/preview?template=<id>&name=<n>[&store=<slug>]` renders a template on its
own with sample data, or a store's live catalogue, inert (no pointer events).
The store form embeds it in a phone-sized iframe on the right; picking a
template or typing the name updates it. The proxy serves `/preview` on the
admin host only.

**Store content (next).** A template declares the fields a store may fill
in — logo, hero image, headline, button copy, colours — as a typed schema
in its folder (`templates/<id>/content.ts`: key, kind (image | text |
colour), label, default). The admin renders a form from that schema on the
store page (below the identity section) and the values live in a
`store_content` JSONB column plus uploaded images under
`media/stores/<id>/`. The storefront passes `content` to the template, which
falls back to its defaults for anything unset. Product name, price and
pictures stay in Products; content is the chrome around them. The existing
`stores.theme` column is folded into this (colour fields), so nothing is
edited in two places.

## 5. Auth and roles (decided 2026-09-10)

Staff identity is **platform-wide**; access to a store is a **membership**.

1. **Sign-in.** Staff sign in with Google only, at the admin domain
   (`admin.naturebazar.bd`). Google OAuth is configured once, centrally
   (`GOOGLE_CLIENT_ID`). The storefront-level "Google OAuth on/off" flag in
   `store_settings` is reserved for future *customer* sign-in and has nothing
   to do with staff.
2. **First sign-in** creates a platform `users` row with status `pending` and
   zero memberships. A pending user sees only the waiting page; every API
   route behind `get_current_user` answers 403.
3. **Users page (super admin).** Lists pending, active and disabled users
   (the DB value for disabled is still `suspended`; only the label changed),
   approves or disables them, and manages memberships: a user is assigned to
   one or more stores with a per-store role via `PUT /api/users/{id}/memberships`
   (replace-all). Removing the last membership keeps the account; the user
   sees the waiting page again.
4. **After login** the admin loads `GET /api/me/stores`. One store: selected
   automatically. Several: the switcher in the sidebar header lists only
   those, remembers the last choice (`localStorage` `nb_admin_store`), and
   the selection is sent as `X-Admin-Store` on every admin request. The API
   dependency `tenancy.admin_store` verifies it: 400 without the header,
   404 for an unknown or inactive store, 403 for a non-member. Super admins
   see every active store in the switcher and a **Platform** section
   (Stores, Users, System) no store role can reach.
5. **Audit fields** (`order_events.actor_id`, `order_tags.created_by`,
   `orders.assigned_to/handled_by`) reference the platform user id. Store
   scoping comes from the membership check, never from the client.
6. **Dev login** (`DEV_LOGIN_EMAIL`) stays for local work. It creates the
   account approved, as super admin, and as `owner` of every active store,
   so the switcher can be exercised; the endpoint 404s when unset.
7. **Seed rule.** Emails in `SUPER_ADMIN_EMAILS` are auto-approved as super
   admin on first sign-in and re-promoted on every request, so they are
   always super admin and cannot be demoted from the UI. Super admins can
   promote other users to super admin from the UI, and those can be demoted
   again (never the last one).

### Store roles and permissions

Table `store_users (store_id, user_id, role)`, migration 0019. Role is a
string validated by the API. Permission table in `api/tenancy.py`, mirrored
in `auth-context.tsx`:

| permission | owner | manager | staff |
|---|---|---|---|
| orders (lists, claim, status, manual order, tags) | ✓ | ✓ | ✓ |
| catalogue.read (manual order form needs it) | ✓ | ✓ | ✓ |
| catalogue.write (products) | ✓ | ✓ | |
| settings (Phase 2: pixel, CAPI, Pathao, theme) | ✓ | | |
| members.read (see the store's staff) | ✓ | ✓ | |
| members.write (assign manager/staff within the store; Phase 3 UI) | ✓ | | |

A super admin passes every check with role `super_admin`. Platform routes
(`/api/stores`, `/api/users`, `/api/system`) require `require_super_admin`.

## 6. Existing single-store data

v1 stays frozen. When v2 goes to production it starts with an empty database;
the v1 data is imported once by `scripts/import_v1.py`:

1. `pg_dump` v1 → restore into schema `v1` of the v2 database.
2. Create store `naturebazar` with domains `naturebazar.shop` (+ aliases),
   template `classic`, settings copied from v1's `.env` (encrypted on write).
3. `INSERT … SELECT` each table from `v1.*` **preserving ids** (order numbers
   `NB-<id>` are printed on stickers and in Meta as event ids), setting
   `store_id`; then `setval` every sequence past the max id.
4. Copy the media volume; image paths keep their names.
5. Verify counts, then drop schema `v1`.

Because ids are preserved, the import must run before any real v2 order
exists; demo stores are dev-only and never seeded in production.

## 7. Risks and what in v1 fights this

- **Module-level `settings` singleton** referenced inside `meta_capi`,
  `pathao`, `pathao_sync`, `catalogue`, tests. Every one becomes a parameter.
  Biggest refactor, mostly mechanical; tests currently monkeypatch
  `settings.*` and must move to passing `StoreSettings`.
- **Global "one active product"** partial index and `catalogue.active()`
  with no store argument. Migration + signature change.
- **Order number prefix** `NB-` hardcoded in the API (`f"NB-{id}"`,
  `ORDER_NO_RE`) and in `lib/api.ts` (`NB-${id}`). Becomes
  `store.order_prefix`. Meta `event_id` for Purchase is the order number, so
  it stays unique across stores only because ids are one global sequence —
  keep one sequence.
- **Build-time pixel/GTM/Google ids** (section 3).
- **Root layout** serves both admin and storefront; split into route groups
  so the storefront layout can be per-store and the admin has none of it.
- **`pathao_sync`** is one loop with one advisory lock and global creds;
  becomes a loop over stores with Pathao enabled, lock per store.
- **`integration_tokens` pk = provider**; token cache keyed by store.
- **`visits.summary()` / dashboard / system overview** are unscoped; the
  System page splits into platform health (unscoped, super admin) and
  per-store figures.
- **Cookies**: `_fbp/_fbc` are per hostname already. `nb_session` is set on
  the admin host only. The dev `__store` cookie is dev-only.
- **CORS `FRONTEND_ORIGIN`** is irrelevant while everything is same-origin
  through the Next rewrite; keep it that way for arbitrary domains rather
  than opening CORS.
- **Reverse proxy**: OpenLiteSpeed must forward the original `Host` to
  127.0.0.1:8090 unchanged (no host rewrite) and keep `X-Forwarded-For`.
  Arbitrary customer domains need a wildcard/catch-all vhost and per-domain
  TLS; that is an ops task, tracked in the plan.
- **Performance**: a storefront page currently makes two API calls (config
  + listing). Both hit in-process caches on the API; the config is also
  cached in Next. If it shows in p95, merge them into `/api/storefront/page`.
- **Media** paths are global (`products/<random>.jpg`); fine because names
  are random, but a per-store prefix is cheap to add when products get
  `store_id`.
- **Rate limiter** keys on IP only; a hot campaign on one store can throttle
  another store's customers behind the same CGNAT address. Consider
  `(store, ip)` keys if that ever bites.
