/**
 * A v4 UUID. `crypto.randomUUID` exists only in secure contexts (HTTPS or
 * localhost), so a store or the admin served over plain HTTP — a dev
 * hostname, a customer's domain before its certificate — would throw. The
 * fallback is the same shape from Math.random; these ids key drafts and
 * analytics events, not security.
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
