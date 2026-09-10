#!/usr/bin/env bash
# Point another hostname at an existing store, from the server, without the
# admin UI. Usage:
#   scripts/add-store-domain.sh <store-slug> <hostname> [--primary]
# Run from the repo root (it uses this project's compose db service). The API
# picks the change up within ~30 s (per-worker cache). The same thing can be
# done in Admin → Stores → Edit → Domain.
set -euo pipefail
slug="${1:-}"; host="${2:-}"; primary="${3:-}"
if [[ -z "$slug" || -z "$host" ]]; then
  echo "usage: $0 <store-slug> <hostname> [--primary]" >&2; exit 2
fi
host="$(echo "$host" | tr '[:upper:]' '[:lower:]' | sed -E 's/:[0-9]+$//; s/\.+$//')"
if ! [[ "$host" =~ ^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$ ]]; then
  echo "not a hostname: $host" >&2; exit 2
fi
db="${POSTGRES_DB:-nbplatform}"; user="${POSTGRES_USER:-nbplatform}"
psql() { docker compose exec -T db psql -U "$user" -d "$db" -v ON_ERROR_STOP=1 -qAt "$@"; }
store_id="$(psql -c "select id from stores where slug = '$slug';")"
if [[ -z "$store_id" ]]; then echo "no store with slug '$slug'" >&2; exit 1; fi
owner="$(psql -c "select s.slug from store_domains d join stores s on s.id=d.store_id where d.host = '$host';")"
if [[ -n "$owner" && "$owner" != "$slug" ]]; then echo "'$host' already belongs to store '$owner'" >&2; exit 1; fi
if [[ "$primary" == "--primary" ]]; then
  psql -c "update store_domains set is_primary = false where store_id = $store_id;"
  psql -c "insert into store_domains (store_id, host, is_primary) values ($store_id, '$host', true)
           on conflict (host) do update set is_primary = true;"
else
  psql -c "insert into store_domains (store_id, host, is_primary) values ($store_id, '$host', false)
           on conflict (host) do nothing;"
fi
echo "$host -> $slug (store id $store_id)$( [[ "$primary" == "--primary" ]] && echo ', primary')"
psql -c "select host, is_primary from store_domains where store_id = $store_id order by is_primary desc, host;"
