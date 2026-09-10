# nbPlatform

Multi-store platform (v2 of Nature Bazar): one Next.js app serving every storefront and the admin, one FastAPI backend, one PostgreSQL. **Start with `DEV.md` for local development and `docs/DESIGN-V2.md` for the design.** The notes below are inherited from v1 and describe the production shape; ports are now 8090 (web) and 8001 (API).

## Start on the server

```bash
cp .env.example .env
# Edit .env and set a real POSTGRES_PASSWORD
docker compose up -d --build
docker compose ps
```

The web app is available on the server at `127.0.0.1:3000`. The API is available on the server at `127.0.0.1:8000`. PostgreSQL is internal to the Compose network.

## Put it behind a proxy

Both ports bind to loopback, so something has to sit in front. Either works:

- **Cloudflare Tunnel**: ingress rule for your hostname → `http://localhost:${WEB_PORT}`. Leave `CLIENT_IP_HEADER` at its default (`cf-connecting-ip`).
- **Plain reverse proxy** (nginx, OpenLiteSpeed): proxy to `http://127.0.0.1:${WEB_PORT}` and set `CLIENT_IP_HEADER=x-forwarded-for` in `.env`. The web container forwards `/api` and `/media` to the API, so only one upstream is needed.

The header names where the API reads the visitor's real IP for rate limiting. Check it landed in Admin → System → "Client address header". See `COMMANDS.md` → "Attack protection" for details.

## Meta tracking

Every browser Pixel event has a server-side twin with the same event id (Conversions API), so Meta deduplicates the pair and still counts the event when the browser copy is blocked. To verify after a deploy, set `META_TEST_EVENT_CODE` from Events Manager → Test Events, watch each event arrive as a deduplicated browser+server pair (including PageView when the tab is closed right after load), then **clear the code again** — while it is set, live Purchases go to the test tab. Full steps in `COMMANDS.md` → "Meta Pixel & Conversions API".

Useful checks:

```bash
curl http://127.0.0.1:3000
curl http://127.0.0.1:8000/health
docker compose logs -f web api
```

## Open it from a Mac over SSH

Run this on the Mac, replacing `SERVER_USER` and `SERVER_HOST`:

```bash
ssh -N -L 3000:127.0.0.1:3000 SERVER_USER@SERVER_HOST
```

Keep that terminal open, then visit <http://localhost:3000> in the Mac browser. The `-L` flag forwards the Mac's port 3000 to the server's loopback port 3000, so no public firewall rule is needed.

To open the API docs from the Mac as well:

```bash
ssh -N -L 8000:127.0.0.1:8000 SERVER_USER@SERVER_HOST
```

Then visit <http://localhost:8000/docs>.

## Stop

```bash
docker compose down
```

`docker compose down` keeps the `postgres-data` volume. Use `docker compose down -v` only when you intentionally want to delete the database.
