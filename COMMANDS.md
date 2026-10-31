# Nature Bazar — Operations Cheat Sheet

All commands run from the project root: `cd ~/projects/natureBazar`

## URLs
| What | Where |
|---|---|
| Public site | https://naturebazar.iamshehab.com |
| Local web (storefront + admin) | http://localhost:8085 |
| Local API (direct) | http://localhost:8000 (`/docs` = Swagger) |

## Redeploy after code changes

```bash
# Frontend changed (anything under frontend/)
docker compose build web && docker compose up -d web

# Backend changed (anything under backend/) — migrations run automatically on start
docker compose build api && docker compose up -d api

# Both
docker compose build web api && docker compose up -d web api
```

## Restart without rebuilding (no code changes)

```bash
docker compose restart web        # or api
docker compose up -d --force-recreate api   # needed when .env changed
```

`.env` changes (passwords, Google keys, SUPER_ADMIN_EMAILS…) only need the
force-recreate of `api` — no rebuild. Frontend build-time vars
(GOOGLE_CLIENT_ID) DO need `build web`.

## Meta Pixel & Conversions API

| Variable (.env) | Used by | Applies after |
|---|---|---|
| `META_PIXEL_ID` | web (browser pixel) + api (CAPI) | `docker compose build web && docker compose up -d web` and `docker compose up -d --force-recreate api` |
| `META_CAPI_ACCESS_TOKEN` | api | `docker compose up -d --force-recreate api` |
| `META_TEST_EVENT_CODE` | api | same; **leave empty in production** — while it is set, every server event, live Purchases included, lands in Events Manager → Test Events instead of the real event stream |
| `RATE_LIMIT_TRACK` | api | same; POST /api/track per IP per minute (default 60) |

**How it fits together.** Every browser event (PageView, ViewContent,
AddToCart, InitiateCheckout, Purchase) is also sent from the server through
the Conversions API with the same event id, so Meta deduplicates the pair and
still counts the event when the browser copy never arrived (ad blocker, tab
closed early). The fbq stub is inlined in the document head before anything
else, so no event is dropped for firing early; `fbevents.js` itself loads on
the first interaction or after 1.5 s. Purchase uses the order number as the
shared id and is sent by `POST /api/orders`; the other four mint a UUID in the
browser and report it to `POST /api/track`. Server sends retry (1 s, 3 s, 9 s)
and anything Meta still refuses is parked in `meta_capi_failed_events` — Admin
→ System shows the count with a **Resend** button. Orders typed in by staff
(Admin → Orders → Manual) send no Purchase: they are not web sales.

Code: browser side `frontend/src/lib/tracking.ts` (events, ids, the
/api/track post), `frontend/src/lib/pixel-bootstrap.ts` (the inline stub, the
`_fbp`/`_fbc` cookies, the first PageView), `frontend/src/components/MetaPixel.tsx`
(deferred SDK load, route-change PageView). Server side
`backend/api/routers/track.py` and `backend/api/services/meta_capi.py`.

**Verify in Events Manager (after any change to tracking):**

1. Set `META_TEST_EVENT_CODE` to the code shown under Events Manager → your
   pixel → **Test Events**, then `docker compose up -d --force-recreate api`.
2. Open the storefront in a private window. In the Test Events tab each event
   must appear **twice — Browser and Server — and be marked "Deduplicated"**;
   the two rows share the event id. Check PageView, ViewContent (once per
   size), AddToCart (one pair per tap), InitiateCheckout (on first form focus)
   and Purchase (order number as id).
3. **Close the tab immediately after load.** The PageView pair must still
   arrive: the server copy goes out via keepalive before hydration.
4. In the browser console, `localStorage.trackingDebug = "1"` and reload
   prints every fbq call and every /api/track post with its id. On the server
   `docker compose logs api | grep CAPI` shows each send, retry and rejection.
5. **Afterwards clear `META_TEST_EVENT_CODE`** and force-recreate `api`
   again. The System page shows "(test)" on the CAPI badge and a warning tone
   while it is set, because live Purchases are going to the test tab.

Parked events: `GET /api/system/capi/failed` lists them, the System page's
Resend button (or `POST /api/system/capi/failed/resend`) retries each once,
`DELETE /api/system/capi/failed/{id}` drops one. Meta accepts website events up
to seven days old; older parked rows will keep failing and should be deleted.

## Pathao Courier

Keys live in `.env` (runtime vars, so `docker compose up -d --force-recreate api`
after changing them — no rebuild):

| Variable | Sandbox value | Live value |
|---|---|---|
| `PATHAO_BASE_URL` | `https://courier-api-sandbox.pathao.com` | `https://api-hermes.pathao.com` |
| `PATHAO_CLIENT_ID` | `7N1aMJQbWm` | merchant.pathao.com → Developer API → Client ID |
| `PATHAO_CLIENT_SECRET` | `wRcaibZkUdSNz2EI9ZyuXLlNrnAv0TdPUPXMnD39` | same page → Client Secret |
| `PATHAO_USERNAME` | `test@pathao.com` | your merchant panel login email |
| `PATHAO_PASSWORD` | `lovePathao` | your merchant panel password |
| `PATHAO_STORE_ID` | `150833` | from the check below |
| `PATHAO_UNIT_WEIGHT_KG` | `1` | real weight of one combo, in kg |

Check the keys and find the store id (super admin session cookie needed, so
easiest in the browser): open `http://localhost:8085/api/system/pathao`. It
shows `enabled`, whether it is the sandbox, and every store the credentials
can see with its `store_id`. Copy the right one into `PATHAO_STORE_ID`.

Sending happens from Admin → Orders → Ship: tick rows → **Send to Pathao**.
The consignment id appears in the Pathao column and links to Pathao's tracking
page. **Refresh Status** pulls the latest delivery status. Access tokens are
cached in the `integration_tokens` table and renewed automatically. Logs:
`docker compose logs api | grep -i pathao`.

## Attack protection

Two layers. The app layer protects the database; only Cloudflare can absorb a
flood that fills the pipe, so make sure both are on.

**Inside the API (per IP, per 10 minutes — set in `.env`, then
`docker compose up -d --force-recreate api`):**

| Variable | Default | Guards |
|---|---|---|
| `RATE_LIMIT_ORDERS` | 30 | `POST /api/orders` (placing an order) |
| `RATE_LIMIT_DRAFTS` | 300 | `POST /api/orders/draft` (form autosave) |
| `RATE_LIMIT_LOGINS` | 20 | `POST /api/auth/google` |
| `RATE_LIMIT_WINDOW_SECONDS` | 600 | the window for the three above |
| `RATE_LIMIT_TRACK` | 60 | `POST /api/track` (Meta event twins), per minute |
| `ORDER_COOLDOWN_HOURS` | 0 | one storefront order per phone number per window; 0 = for good |

Limits are deliberately loose: Bangladeshi mobile carriers put thousands of
customers behind one shared IP (CGNAT), so a tight limit turns a campaign
spike into lost orders. Counters are per worker (`UVICORN_WORKERS=2`), so the
effective ceiling is up to 2× the number above. Set a value to `0` to turn
that limit off.

The client address comes from the header named in `CLIENT_IP_HEADER`:
`cf-connecting-ip` behind Cloudflare (the default), `x-forwarded-for` behind
nginx/OpenLiteSpeed. The header may be a comma-separated list; the API takes
the rightmost public address, which is the one our own proxy appended and the
only one a client cannot plant. If the header ever stops arriving (proxy
swapped, variable not updated), the limiter switches itself off rather than
lock everyone out, and logs a warning once. Blocked addresses show up as:

```bash
docker compose logs api | grep ratelimit
```

**At the edge (Cloudflare dashboard → the site):**

1. **Security → WAF → Rate limiting rules** — add one:
   expression `(http.request.uri.path eq "/api/orders" and http.request.method eq "POST")`,
   10 requests per 10 seconds per IP, action *Block* for 10 seconds.
   This stops a flood before it reaches the tunnel at all.
2. **Security → Bots → Bot Fight Mode: On.**
3. During an incident: **Overview → Under Attack Mode: On** (every visitor
   gets a 5-second JS challenge; turn it off afterwards).

The origin is only reachable through the tunnel (`8000` and `8085` bind to
`127.0.0.1`), so attackers cannot bypass Cloudflare by hitting the server's
IP directly. Keep it that way.

**Behind a plain reverse proxy instead (nginx, OpenLiteSpeed):** proxy the
site to `http://127.0.0.1:${WEB_PORT}` (the web container; it forwards `/api`
and `/media` to the API itself), make sure the proxy sets `X-Forwarded-For`,
and put `CLIENT_IP_HEADER=x-forwarded-for` in `.env`, then
`docker compose up -d --force-recreate api`. Admin → System → "Client address
header" should show the visitor's real IP. Without Cloudflare there is no edge
rate limit, so the API's own limits are the only brake.

## Visitors & conversion (Admin → System)

The System page's **Visitors** section counts distinct browsers on the
storefront and how many of them ordered, for today, the last 7 and the last
30 days (Dhaka days). It is fed by the PageView report every storefront page
load posts to `/api/track`, so it only counts while `META_PIXEL_ID` is set
(the page does not post without a pixel id; the CAPI token is not needed).
A visitor is the hash of the browser's `_fbp` cookie — or of address + user
agent without one — nothing identifying is stored. Rows live in the `visits`
table for 400 days. Web orders means orders placed on the site: staff-typed
orders and abandoned forms are not counted. Code: `backend/api/visits.py`.

## Status & logs

Without SSH: **Admin → System** (super admins only) shows API/database health,
requests per minute across both workers, 429/409/5xx counts, who is currently
rate-limited, host load/memory/disk, and the last warnings and errors — refreshed
every 10 s. It also tells you whether Cloudflare's client address is reaching
the API; if that tile ever turns red, per-IP limiting is off.

```bash
docker compose ps
docker compose logs -f api        # follow API logs (Ctrl+C to stop)
docker compose logs -f web
docker compose logs api --tail 50 # last 50 lines
```

## Quick health checks

```bash
curl http://localhost:8085/                    # storefront (200)
curl http://localhost:8085/api/orders/stats    # 401 = auth wall working
curl http://localhost:8000/health              # API + DB check
```

## Database

```bash
# psql shell inside the container
docker compose exec db psql -U nature_bazar -d nature_bazar

# one-off queries
docker compose exec -T db psql -U nature_bazar -d nature_bazar \
  -c "SELECT status, count(*) FROM orders GROUP BY 1;"

# backup / restore
docker compose exec -T db pg_dump -U nature_bazar nature_bazar > backup-$(date +%F).sql
cat backup-YYYY-MM-DD.sql | docker compose exec -T db psql -U nature_bazar -d nature_bazar
```

Useful tables: `orders`, `order_tags`, `order_events` (audit trail), `users`.

## Stop / start everything

```bash
docker compose stop               # stop, keep containers
docker compose start
docker compose down               # remove containers (DB data survives in the volume)
docker compose up -d              # bring the whole stack up
docker compose down -v            # DANGER: also deletes the database volume
```

## Local dev (hot reload, without Docker)

```bash
# Frontend on :3000, proxying /api to the dockerized API on :8000
cd frontend && API_URL=http://localhost:8000 npm run dev

# Backend with reload (stop the api container first: docker compose stop api)
cd backend && DATABASE_URL=postgresql://... uvicorn main:app --reload --port 8000
```

## Cleanup

```bash
docker image prune -f             # old image layers after rebuilds
docker system df                  # what's using disk
```

## Access from Mac

Tunnel only port 8085 is needed now (API is proxied through the web app):
```bash
ssh -N -L 8085:localhost:8085 shehab@<server>
# then open http://localhost:8085
```
Or just use https://naturebazar.iamshehab.com.
