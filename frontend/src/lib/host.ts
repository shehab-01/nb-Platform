// Pure helpers for the Host -> role decision the proxy (middleware) makes on
// every request. No I/O here on purpose: the proxy must never wait on the
// network, so everything it needs is a string comparison against env.

/** "Store1.NB.local:8090." -> "store1.nb.local"; null for nothing usable. */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.split(",")[0].trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end > 0 ? host.slice(1, end) : host.slice(1);
  } else if (host.split(":").length === 2) {
    host = host.split(":")[0];
  }
  host = host.replace(/\.+$/, "");
  return host || null;
}

export type HostRole = "admin" | "store";

/**
 * The admin lives on the hostname(s) in ADMIN_HOST (comma-separated; more
 * than one is for a dev alias or a domain move). Every other hostname is a
 * storefront candidate; whether a store actually answers there is the API's
 * decision, made from the database, not the proxy's.
 */
export function classifyHost(host: string | null, adminHost: string): HostRole {
  if (host === null) return "store";
  const admins = adminHost
    .split(",")
    .map((h) => normaliseHost(h))
    .filter((h): h is string => h !== null);
  return admins.includes(host) ? "admin" : "store";
}

/** A store slug as allowed in ?__store=; anything else is ignored. */
export function validSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) ? slug : null;
}
