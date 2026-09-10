# v1 architecture (natureBazar, as inherited)

What the codebase looked like when nbPlatform forked from it. This is the
material v2 reshapes; nothing here is a target design. See `DESIGN-V2.md`.

## Shape

Three containers: `db` (Postgres 17), `api` (FastAPI, uvicorn, 2 workers,
runs `alembic upgrade head` on boot), `web` (Next.js 16 standalone). Only the
web port is meant to be exposed: `next.config.ts` rewrites `/api/*` and
`/media/*` to the API container, forwarding every header (cookies included),
so the browser talks to one origin and CORS is moot. In production an
OpenLiteSpeed reverse proxy fronts the web port and adds `X-Forwarded-For`.

## Backend (`backend/`)

**Models** (`api/models.py`, 17 migrations): `orders` (customer, phone,
normalised `phone_key`, product snapshot columns, `status` as a free string,
`source` website/incomplete/manual, `draft_key` for abandoned forms, claim
fields `assigned_to/assigned_at`, `handled_by`, printed/courier flags, Pathao
consignment fields), `order_items` (lines, snapshot of name/price),
`order_tags`, `order_events` (append-only audit trail; the dashboard and
per-worker stats aggregate from it), `users` (Google identity, `role`
super_admin|staff, `status` pending|active|suspended, nickname),
`products` + `product_variants` (one product active at a time, enforced by a
global partial unique index; variants carry price, sku, image, default flag),
`integration_tokens` (one row per provider, Pathao's OAuth token shared by
all workers), `meta_capi_failed_events` (parked CAPI payloads for resend),
`traffic_minutes` (per-worker request counters), `visits` (hashed visitor +
path per PageView).

**Routers** (all under `/api`): `auth` (Google ID-token login, signed
`nb_session` cookie via itsdangerous, `/me`, logout), `orders` (public
`POST /orders` and `POST /orders/draft` with per-IP limiters; authenticated
list/counts/claims/stats/dashboard/lookup/manual/claim/release/tags/bulk/
patch; Pathao send/refresh), `users` (super admin CRUD of staff), `products`
(super admin catalogue writes, staff reads) plus a `storefront` public router
(`/storefront/listing`, `/storefront/product`), `system` (overview page:
DB, traffic, visitors, rate limiters, integrations, recent logs; Pathao
status; CAPI failed-event resend), `track` (public `POST /track`).

**Order flow**: the landing page posts `{customer_name, phone, address,
quantity, variant_id, note, draft_key}`. The API prices the order from the
catalogue row (never from the client), refuses a phone that ordered within
`ORDER_COOLDOWN_HOURS`, promotes an autosaved Incomplete draft to a real
order when one exists (matching by `draft_key`, then by phone), writes an
`order_events` row, deletes any other open draft for that phone, then fires
the server-side Meta Purchase event with `event_id = "NB-<id>"` as a detached
asyncio task. Staff then move the order through statuses (processing →
confirmed → shipped → history, or the no-response/hold/cancelled branches),
claim rows while phoning (claims expire after `CLAIM_TTL_MINUTES`), and book
parcels with Pathao; `pathao_sync` polls Pathao for status changes under a
Postgres advisory lock so only one worker polls.

**Tracking**: the root layout inlines a hand-written ES5 bootstrap
(`lib/pixel-bootstrap.ts`) that defines the `fbq` stub, sets `_fbp`/`_fbc`
cookies, fires PageView with a fresh UUID and POSTs the same id to
`/api/track` with `keepalive`. `MetaPixel.tsx` loads `fbevents.js` lazily and
fires PageView on client navigations. `lib/tracking.ts` fires
ViewContent/AddToCart/InitiateCheckout/Purchase in the browser and posts the
non-purchase ones to `/api/track`; `services/meta_capi.py` sends the twin to
the Conversions API with the same `event_id`, retrying with backoff and
parking failures. `/api/track` also records a `visits` row for PageView.
Admin paths are excluded on both sides. The client IP comes from
`ratelimit.client_ip()`: the rightmost non-internal entry of the header named
by `CLIENT_IP_HEADER`.

**Auth**: Google Identity Services in the browser → `POST /auth/google` →
verified with google-auth → user row created (pending unless the email is in
`SUPER_ADMIN_EMAILS`) → signed cookie. Two roles, both global. Every admin
endpoint depends on `get_current_user`; super-admin-only ones on
`require_super_admin`.

**Cross-cutting**: `api/config.py` is a module-level `Settings` singleton
read from env at import time and referenced directly by every service
(`settings.meta_pixel_id`, `settings.pathao_*`, …). `ratelimit.py` is
in-memory per process. `monitoring.py` is a pure-ASGI middleware counting
requests per minute plus a ring buffer of recent WARNING+ logs.

## Frontend (`frontend/src`)

App Router. `app/layout.tsx` (fonts, pixel bootstrap, `<MetaPixel/>`) wraps
everything, admin included. `app/page.tsx` is a server component that fetches
`/api/storefront/listing` from the API directly (`API_URL`) and renders
`components/landing/landing.tsx`, a single client component (~450 lines) with
its own scoped CSS (`landing.css`, `.nb-*`). `app/legacy/page.tsx` is the
previous storefront behind `SHOW_LEGACY_LANDING`. `app/admin/**` is the
staff app: `login/page.tsx` (Google button), a `(dashboard)` route group whose
layout mounts `AdminAuthProvider` (client-side `/api/auth/me` gate), shadcn
sidebar/header, and pages for dashboard, each order status list, manual
order, products, users, system. Data access is `lib/api.ts` (admin, maps
snake_case → camelCase) and `lib/storefront-api.ts` (the only API module the
landing bundle contains). Tests: vitest for `lib/*.test.ts`; pytest for the
API's pure parts (limiter, CAPI, track router) with no database.

## Build-time configuration (what v2 must remove)

Baked into the web image by `frontend/Dockerfile` build args:
`NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
`lib/tracking.ts` exports `PIXEL_ID` as a constant and `app/layout.tsx`
computes the bootstrap string once at module load. Everything else (Pathao,
CAPI token, rate limits, `CLIENT_IP_HEADER`, `SHOW_LEGACY_LANDING`,
`API_URL`) is a runtime env var, but global to the deployment, not per store.
