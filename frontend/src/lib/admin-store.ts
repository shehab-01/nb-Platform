// Which store the admin is working in. The API is told with the
// X-Admin-Store header on every request (see lib/http.ts) and checks the
// signed-in user's membership; this module only remembers the choice.

export type StoreAccess = {
  storeId: number;
  slug: string;
  name: string;
  /** "super_admin" for a platform super admin, else the membership role. */
  role: string;
};

const STORAGE_KEY = "nb_admin_store";
let current: number | null = null;

/** The id sent as X-Admin-Store, or null before a store has been chosen. */
export function getAdminStoreId(): number | null {
  return current;
}

export function setAdminStoreId(id: number | null): void {
  current = id;
  try {
    if (id === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // storage blocked; the choice lives for this page load only
  }
}

export function readRememberedStoreId(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Which store to open: the remembered one if it is still in the list, else
 * the first. One store means no choice to make. Null when there is nothing
 * to open. Pure, so the rule is testable.
 */
export function pickStore(
  stores: StoreAccess[],
  remembered: number | null,
): StoreAccess | null {
  if (stores.length === 0) return null;
  return stores.find((s) => s.storeId === remembered) ?? stores[0];
}
