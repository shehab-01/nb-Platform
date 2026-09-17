# Pathao address parser

Pathao's merchant panel auto-fills city / zone / area from a free-text address.
We use the same endpoint to pre-fill the delivery-location dropdowns on the
manual order form and in the order details modal. This note records what was
verified so nobody has to rediscover it, and what to expect when it breaks.

## The endpoint is undocumented

```
POST https://merchant.pathao.com/api/v1/address-parser
Authorization: Bearer <token>
Content-Type: application/json

{"address": "<free text, Bangla or English>"}
```

It is **not** on the courier API host (`api-hermes.pathao.com`, or the sandbox
`courier-api-sandbox.pathao.com`), and it is not in Pathao's developer docs.
It is what the merchant panel's own front end calls. It can change or vanish
on any Pathao deploy, so:

- everything about it lives in `backend/api/services/pathao_address.py`, which
  normalises the answer into our own `ParseResult`;
- every failure — timeout (2.5 s), 5xx, garbage, breaker open — answers
  `matched=false`, never an error, and the form falls back to the dropdowns;
- a circuit breaker pauses calls for two minutes after three failures in a row;
- positive answers are cached in `pathao_address_parses` (Postgres, two weeks,
  keyed by a SHA-256 of the normalised address, platform-wide because the
  answer does not depend on the merchant).

`PATHAO_PARSER_URL` (defaults to the URL above) can be set empty to switch the
feature off without a deploy of code.

## Why the courier-API token works on it

Verified 2026-09 by decoding both JWTs: the panel's session token and the
token our courier-API integration gets from `issue-token` have the same
`sub`, the same `merchant_id`, the same (empty) `scopes` and the same 90-day
lifetime. They differ only in `aud` (Pathao's first-party client id vs our
developer client id), and the panel's `verify-auth-token` middleware does not
check `aud`. So the token `api.services.pathao.get_access_token()` already
keeps in `integration_tokens` is reused as is. **No panel login, no stored
panel password** — do not add either.

Consequence for development: the sandbox issues tokens signed for the sandbox,
which the live panel host rejects. With `PATHAO_BASE_URL` pointing at the
sandbox the parser answers 401 (surfaced as `matched=false`), so the picker
never auto-fills in dev. The dropdowns still work because the city/zone/area
lists come from the sandbox courier API.

## What the answer looks like

```json
{"message": "Suggested address details.", "type": "success", "code": 200,
 "data": {"district_id": 1, "district_name": "Dhaka",
          "zone_id": 941, "zone_name": "Uttara Sector 10",
          "area_id": null, "area_name": null,
          "hub_id": 125, "hub_name": "Diabari", "source": "ibn",
          "ibn_chain": [{"name": "Road 5", "type": "Transport", "sub_type": "Road"},
                        {"name": "Sector 10", "type": "SubArea", "sub_type": "Sector"},
                        {"name": "Uttara", "type": "Area", "sub_type": "Urban"},
                        {"name": "Dhaka", "type": "Admin", "sub_type": "District"}],
          "history_verified": false}}
```

- `district_id` **is** the courier API's `recipient_city` / `city_id`. Same
  number space; there is no translation table.
- `area_id` is usually `null`, even for well-mapped Dhaka addresses. Treat
  that as the normal case.
- A parse Pathao cannot make is still HTTP 200, with no `data` key at all.
- `ibn_chain` runs from the most specific place outwards. A chain starting at
  `Transport` (a road) or `SubArea` (a sector) is a precise parse; one
  starting at `Admin/Upazilla` is coarse. Bangla addresses are handled
  natively.

Our confidence: **high** when the zone is known and either `history_verified`
is true or the chain starts at a road/sector; **medium** for a zone from a
coarse chain; **low** when there is no zone.

## What lands on the order

`orders.pathao_city_id / pathao_zone_id / pathao_area_id` are what
`build_order_payload()` sends as `recipient_city / recipient_zone /
recipient_area`. Each is omitted (not sent as null) when unset, so an order
with no location books exactly as before this existed: Pathao sorts it from
the address text. A zone is never sent without its city, nor an area without
its zone.

`orders.pathao_address_parse` keeps the parser's whole answer plus
`selected: "parser" | "manual"`, so a failed delivery can be traced to a
coarse or wrong parse, and so address → zone pairs accumulate as data.

## Zone or area not found: what gets sent

Pathao's own documentation for create-order and bulk create (read 2026-09)
says `recipient_city`, `recipient_zone` and `recipient_area` are all
optional, must **not** be sent as `null`, and are "populated automatically
based on the recipient_address" when left out. That is what the code does:
each key is omitted when unset, so an order with no zone, or no area, books
exactly as v1 always has and Pathao sorts it from the address text. Area
stays optional in the picker; the first area under a zone is never
auto-picked, that would silently guess a delivery point.

## When the parse happens

- **Storefront orders**: right after the order is saved, as a background
  task (`parse_order_later`), so the details modal opens with the location
  filled. The customer's response never waits on Pathao. At most two parses
  run at once, so a campaign burst is a trickle to Pathao, not a flood.
- **Manual orders**: the form parses as staff type; an order saved without
  a location is parsed once more in the background.
- **Opening the modal**: still parses when nothing is recorded yet (parser
  was down at creation, or the order predates this), and only fills a blank.

## Endpoints (admin, `orders` permission, `X-Admin-Store`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/orders/pathao/parse-address` | `{address}` → normalised parse for the manual form |
| POST | `/api/orders/{id}/pathao/parse-address` | parse a saved order's address, store it if the order has no location yet |
| GET | `/api/orders/pathao/cities` | Pathao's cities (503 when the store has no Pathao credentials — the picker hides itself) |
| GET | `/api/orders/pathao/cities/{id}/zones` | zones of a city |
| GET | `/api/orders/pathao/zones/{id}/areas` | areas of a zone |

The lists come from the courier API (`city-list`, `zone-list`, `area-list`)
and are cached in-process for a day; they are the same for every merchant.
`PATCH /api/orders/{id}` and `POST /api/orders/manual` take
`pathao_location: {city_id, zone_id, area_id}`.

If bulk order entry or CSV import ever needs parsing, run it through a queue
with capped concurrency — never N parallel calls to this endpoint.
