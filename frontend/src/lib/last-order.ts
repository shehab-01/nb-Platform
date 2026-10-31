// The customer's own record of their last order, on their own device.
//
// This is a convenience, not a guard: the API's per-phone cooldown is what
// actually stops a repeat order. Remembering the order here means someone who
// closes the page and comes back sees their confirmation again — order number,
// "we'll call you on…" — instead of an empty form that would only refuse them.

const KEY = "nb_last_order";
/**
 * How long this device shows the confirmation in place of the form. The API
 * refuses the number for good; this stays short so someone else on the same
 * phone can still order with their own number.
 */
const REMEMBER_MS = 24 * 60 * 60_000;

export type LastOrder = {
  orderNo: string;
  name: string;
  phone: string;
  address: string;
  /** Epoch ms when the order was placed. */
  at: number;
};

export function readLastOrder(): LastOrder | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const order = JSON.parse(raw) as LastOrder;
    if (!order?.orderNo || Date.now() - order.at > REMEMBER_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return order;
  } catch {
    return null;
  }
}

export function rememberOrder(order: LastOrder): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Storage blocked: the confirmation still shows for this page view.
  }
}

export function forgetLastOrder(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to begin with.
  }
}

/**
 * Fires when another tab places or clears an order, so a second open tab
 * swaps its form for the confirmation instead of offering a repeat order.
 */
export function onLastOrderChange(callback: (order: LastOrder | null) => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) callback(readLastOrder());
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
