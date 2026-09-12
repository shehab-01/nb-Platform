// The store a server-rendered page belongs to. Server-only: reads the request
// headers the proxy stamped (see proxy.ts) and asks the API which store the
// hostname resolves to. Cached in this process for a short while so a page's
// several fetches, and the next visitor's, cost nothing.

import { headers } from "next/headers";

const API_BASE = process.env.API_URL ?? "http://api:8000";
const CACHE_TTL_MS = 30_000;

export type StoreConfig = {
  id: number;
  slug: string;
  name: string;
  template: string;
  currency: string;
  theme: Record<string, string>;
  /** Store's own pictures by content key (URLs); defaults come from the template. */
  content: Record<string, string>;
  /** srcset of the resized copies, for content keys that are the store's own upload. */
  content_srcset: Record<string, string>;
  host: string | null;
  domains: string[];
  /** Public by nature (it is in the page source); "" when the store has none. */
  meta_pixel_id: string;
  order_prefix: string;
};

/**
 * Headers that tell the API which store a server-side call is for — the same
 * two the proxy set on the incoming request. Every server-component fetch to
 * the API must forward these, or the API resolves against the container's
 * own hostname and finds nothing.
 */
export async function storeHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const out: Record<string, string> = {};
  const host = h.get("x-store-host");
  const slug = h.get("x-store-slug");
  if (host) out["x-store-host"] = host;
  if (slug) out["x-store-slug"] = slug;
  return out;
}

type Entry = { expires: number; value: StoreConfig | null };
const cache = new Map<string, Entry>();

async function fetchConfig(key: string, hdrs: Record<string, string>) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value: StoreConfig | null = null;
  try {
    const res = await fetch(`${API_BASE}/api/storefront/config`, {
      headers: hdrs,
      cache: "no-store",
    });
    if (res.ok) value = (await res.json()) as StoreConfig;
    else if (res.status !== 404) return hit?.value ?? null; // API trouble: don't cache
  } catch {
    return hit?.value ?? null;
  }
  if (cache.size > 1000) cache.clear();
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/** The store for the current request, or null when no store answers here. */
export async function getStore(): Promise<StoreConfig | null> {
  const hdrs = await storeHeaders();
  const key = hdrs["x-store-slug"]
    ? `slug:${hdrs["x-store-slug"]}`
    : `host:${hdrs["x-store-host"] ?? ""}`;
  return fetchConfig(key, hdrs);
}

/** A store by slug, for the admin's template preview. Dev fallback header;
 * in production the preview shows the store through the same route. */
export async function getStoreBySlug(slug: string): Promise<StoreConfig | null> {
  return fetchConfig(`slug:${slug}`, { "x-store-slug": slug });
}

export type StoreDirectoryEntry = { slug: string; name: string; domains: string[] };

/** Every store, for the dev "no store here" page. Empty in production. */
export async function getStoreDirectory(): Promise<StoreDirectoryEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/api/storefront/directory`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as StoreDirectoryEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * CSS custom properties the classic template reads from the store's theme.
 * Unknown keys are ignored, so a theme can carry more than the template uses.
 */
export function themeVars(theme: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {};
  if (theme.primary) vars["--nb-green"] = theme.primary;
  if (theme.accent) vars["--nb-gold"] = theme.accent;
  if (theme.background) vars["--nb-bg"] = theme.background;
  if (theme.header) vars["--deep"] = theme.header;
  return vars;
}
