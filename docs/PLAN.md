# nbPlatform implementation plan

Small milestones, each ending with the whole test suite green and the dev
stack (`docker compose up -d --build`, see `DEV.md`) working. Design in
`DESIGN-V2.md`. Nothing here is pushed or deployed until you say so.

## Phase 0 — scaffolding (done, 2026-09-10)

- compose project `nbplatform`, ports 8090/8001, dev `.env`.
- Migration 0018: `stores`, `store_domains`.
- `api/stores.py`: host normalisation, TTL cache, `current_store` dependency;
  `GET /api/storefront/config`, dev-only `/directory`.
- `src/proxy.ts`: admin host vs store host, `X-Store-Host`, `?__store=`
  fallback; `src/lib/store.ts` cached `getStore()`.
- Landing page shows the resolved store's name and theme colours.
- Dev-only sign-in (`DEV_LOGIN_EMAIL`), seed script, tests for the above.

## Phase 1 — one store resolved by host, memberships, admin switcher, template #1 (done 2026-09-10)

Ends with: stores table + one store resolved by host + admin store switcher +
the existing landing page rendering as template `classic` for that store, all
tests passing.

1. **Memberships** (DESIGN-V2 §5): migration 0019 `store_users`;
   `api/tenancy.py` with `admin_store` (X-Admin-Store verified against
   memberships), `require(permission)`, role table; `GET /api/me/stores`;
   `PUT /api/users/{id}/memberships`. Tests: pending blocked, header checked
   against memberships, super admin bypass, switcher lists only assigned
   stores (`tests/test_tenancy.py`).
2. **Stores API (super admin)**: `GET/POST /api/stores`, `PATCH /api/stores/{id}`
   with domains (normalised, unique across stores, first = primary),
   template validated against the registry mirror, cache invalidation.
3. **Admin switcher**: auth context loads memberships, auto-selects a single
   store, remembers the choice, sends `X-Admin-Store` on every admin request
   (`lib/http.ts`); sidebar header dropdown lists only accessible stores;
   Platform group (Stores, Users, System) for super admins; **Stores** page
   with create/edit dialog; **Users** page gains a Stores column and an
   "Assign stores" dialog; "Disabled" wording.
4. **Template registry**: `src/templates/{index,types}.ts`, `classic/`
   (moved landing page + Closed), dynamic import per template, unknown →
   classic with a warning; `page.tsx` picks by `store.template`. Tests for
   the registry.
5. **Products per store**: migration 0020 (`products.store_id`, per-store
   single-active index, orphan backfill), `catalogue.*` take a store id,
   products router scoped by `admin_store` (reads: any role, writes:
   owner/manager), storefront listing per store; public order/draft
   endpoints price against the resolved store's catalogue. Seed gives each
   demo store its own product and makes the dev admin an owner of both.

Deferred from Phase 1 to Phase 2/3: route groups and the per-request pixel
bootstrap (needs the pixel id from store settings), owner-managed store
staff UI, manual order variant scoping (with orders in Phase 3).

## Phase 2 — per-store settings, encryption, runtime pixel

1. ~~`APP_ENCRYPTION_KEY` + `api/crypto.py` (MultiFernet, rotation, tests)~~
   done 2026-09-10. Secret writes answer 503 when the key is missing.
2. ~~Migration 0021 `store_settings`; `GET/PUT /api/stores/{id}/settings`
   (super admin; never returns secrets)~~ done. Still to do: a cached
   `StoreSettings` loader for the services, and opening the endpoint to store
   owners (`settings` permission) on their own Settings page.
3. ~~Store page holds the settings: pixel id, CAPI token, test event code,
   Pathao (client id/secret/email/password/store id/item type/weight),
   FraudBD API key~~ done, on the store-scoped `/admin/settings` page
   (permission `settings`; API checks the path store equals X-Admin-Store).
   Still to do: order prefix, Google flag, theme.
4. Storefront: route groups `(store)`/`(admin)`, `<script id="nb-store">`
   public config, `tracking.ts` reads it, pixel bootstrap per request from
   the store layout, remove `NEXT_PUBLIC_*` build args from
   `Dockerfile`/compose. (Google client id already runtime via
   `/api/auth/providers` since Phase 1.) Vitest for `pixelBootstrap` with a runtime id and
   for `getStoreConfig()`.
5. `/api/track` and CAPI per store: `meta_capi.dispatch(event, settings)`,
   `visits.store_id`, `meta_capi_failed_events.store_id`, resend per store.
   Existing pytest suite adapted from monkeypatching `settings` to passing
   `StoreSettings`.

## Phase 2b — store content (DESIGN-V2 §4.1) — pictures done 2026-09-10

1. ~~Picture fields per template in `templates/catalog.ts` (`content`), with
   defaults from /public; `resolveContent()`~~ done. Text/colour fields later.
2. ~~Migration 0022 `stores.content`; `GET /api/stores/{id}/content`,
   `PUT/DELETE /api/stores/{id}/content/{key}` (upload / back to default) into
   `media/stores/<id>/`~~ done.
3. ~~Settings → Pictures section per template field (Upload / Replace / Use
   default); preview iframe shows saved pictures~~ done.
4. ~~Storefront passes `content` into the template~~ done. Still to do:
   fold `theme` into content colours; second template "Bazar Campaign" exists
   as the proof.

## Phase 3 — orders per store (done 2026-09-10)

1. ~~Migration 0023: `orders.store_id`, `order_events.store_id`, indexes led
   by store; manual-order variants restricted to the store's catalogue~~.
   Still to do: owner-managed store staff UI (`members.write`).
2. ~~Public order + draft endpoints scoped by `current_store`; cooldown and
   draft lookups per store; `order_no` = `<store prefix>-<id>`~~.
3. ~~Every admin orders endpoint filters on the switcher's store via
   `tenancy.require("orders")`~~.
4. ~~System page: traffic/host platform-wide, visitors/orders/integrations
   for the selected store~~.

## Phase 4 — Pathao and Google per store (Pathao done 2026-09-10)

1. ~~`PathaoConfig` per store; `integration_tokens` keyed `(store_id,
   provider)`; `pathao_sync` iterates active stores with Pathao configured;
   send/refresh use the store's settings, item type and weight~~.
2. ~~`/api/system/pathao` for the selected store~~. Still to do: a "Test
   connection" button on the Settings page.
3. `google_login_enabled` wired to `/api/auth/providers` per host (see the
   assumption in DESIGN-V2 §5).

## Phase 5 — ad attribution capture

1. Migration: attribution columns on `visits` and `orders`, `orders.visit_id`.
2. Bootstrap writes `nb_attr` first-touch cookie; `/api/track` PageView
   payload gains the fields; `visits.record()` stores them.
3. Order POST body gains `attribution`; server copies onto the order.
4. Admin order details modal shows the attribution block. No dashboard yet.

## Phase 6 — v1 import and production side-by-side

1. `scripts/import_v1.py` (DESIGN-V2 §6) with a dry-run mode; rehearse
   against a copy of the v1 dump locally.
2. Production `.env` (8090/8001, `ADMIN_HOST=admin.naturebazar.bd`,
   `CLIENT_IP_HEADER=x-forwarded-for`, encryption key); OpenLiteSpeed
   vhosts for the admin domain and each store domain proxying to
   127.0.0.1:8090 with Host preserved.
3. Bring up v2 with the imported tenant on a staging hostname, verify Pixel
   dedup with a test event code, Pathao sandbox, order flow.
4. Cutover of `naturebazar.shop` DNS/vhost to v2 — **explicit go from you**.

## Phase 7 — proof and cleanup

1. A second, minimal template to prove the mechanism (can be throwaway).
2. Remove `/legacy` and the old `Storefront` component, `SHOW_LEGACY_LANDING`.
3. Per-store rate-limit keys if needed; media path prefix per store.
