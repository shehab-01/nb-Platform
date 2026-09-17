#!/bin/sh
# Compares Pathao credentials saved in v2 (store settings) with v1's .env,
# by SHA-256 hash only. Prints same/different per field, never a value.
set -e
cd "$(dirname "$0")"
V1=${1:-../natureBazar/.env}
h() { printf '%s' "$1" | sha256sum | cut -c1-16; }
val() { grep -E "^$1=" "$V1" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//;s/^'"'"'//;s/'"'"'$//' | tr -d '\r' ; }
docker compose exec -T \
  -e H_ID="$(h "$(val PATHAO_CLIENT_ID)")" -e H_SEC="$(h "$(val PATHAO_CLIENT_SECRET)")" \
  -e H_USER="$(h "$(val PATHAO_USERNAME)")" -e H_PW="$(h "$(val PATHAO_PASSWORD)")" \
  -e V1_STORE="$(val PATHAO_STORE_ID)" -e V1_BASE="$(val PATHAO_BASE_URL)" \
  api sh -c 'cd /app && PYTHONPATH=. python - <<PY
import asyncio, hashlib, os
from api.db import async_session
from api import stores
from api.config import settings
h = lambda v: hashlib.sha256((v or "").encode()).hexdigest()[:16]
async def main():
    async with async_session() as s:
        for sid in range(1, 100):
            i = await stores.load_integrations(s, sid)
            if i and i.pathao.enabled:
                c = i.pathao; break
        else:
            print("v2: no store has Pathao credentials saved"); return
    print("v2 store", sid)
    print("base url  ", "same" if settings.pathao_base_url.rstrip("/") == os.environ["V1_BASE"].rstrip("/") else "DIFFERENT", "(v2:", settings.pathao_base_url + ")")
    for name, v2, v1 in (("client id ", c.client_id, os.environ["H_ID"]), ("secret    ", c.client_secret, os.environ["H_SEC"]),
                         ("email     ", c.username, os.environ["H_USER"]), ("password  ", c.password, os.environ["H_PW"])):
        print(name, "same" if h(v2) == v1 else "DIFFERENT", f"(v2 length {len(v2)})")
    print("store id  ", "same" if str(c.store_id) == os.environ["V1_STORE"].strip() else "DIFFERENT")
asyncio.run(main())
PY'
