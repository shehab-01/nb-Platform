// Ecommerce event tracking.
//
// Every event is pushed to `window.dataLayer` in the GA4 ecommerce format
// (so a GTM container can consume it) and, when the store has a Meta Pixel
// id, mapped to the matching Meta Pixel standard event. The pixel id is the
// store's, read at runtime from the page (lib/store-public); with none the
// events are logged to the console in development so the flow can be
// verified before the id exists.

import { metaCookies } from "@/lib/meta-cookies";
import { publicStoreConfig } from "@/lib/store-public";
import { uuid } from "@/lib/uuid";

/** The current store's Meta Pixel id, "" when it has none. */
export function pixelId(): string {
  return publicStoreConfig().pixelId;
}

/** The platform's GTM container id, "" when there is none. */
export function gtmId(): string {
  return publicStoreConfig().gtmId;
}

export const CURRENCY = "BDT";
export const SHIPPING = 0;

export type TrackedItem = {
  id: string;
  item_id: string;
  item_name: string;
  currency: string;
  price: number;
  item_category: string;
  quantity: number;
};

export type UserData = {
  first_name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    fbq?: (...args: unknown[]) => void;
  }
}

let eventCounter = 0;
const sessionStart = Date.now();

/**
 * Console logging is on in development when no Pixel ID is configured, and
 * can be switched on anywhere (including production) from the browser console:
 *   localStorage.trackingDebug = "1"   // off: delete localStorage.trackingDebug
 */
function debugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem("trackingDebug") === "1") return true;
  } catch {
    // storage blocked; fall through
  }
  return process.env.NODE_ENV !== "production" && !pixelId();
}

function cartValue(items: TrackedItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function push(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const event = {
    ...payload,
    gtm: { uniqueEventId: ++eventCounter, start: sessionStart },
  };
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(event);
  if (debugEnabled()) console.log("[tracking] dataLayer.push", event);
}

/**
 * Whether Pixel calls should go out at all: there is a pixel id, we are in a
 * browser, and this is not an admin page (staff traffic never reaches Meta).
 */
function pixelActive(): boolean {
  if (typeof window === "undefined" || !pixelId()) return false;
  const path = window.location.pathname;
  return !path.startsWith("/admin") && !path.startsWith("/preview");
}

/**
 * Call the Pixel. `window.fbq` is defined synchronously by the inline
 * bootstrap in the document head, before hydration, and queues every call
 * until fbevents.js has loaded — so nothing is dropped for arriving early.
 */
function fbq(...args: unknown[]) {
  if (!pixelActive()) {
    if (debugEnabled()) console.log("[tracking] fbq (pixel off)", ...args);
    return;
  }
  if (debugEnabled()) {
    console.log(
      `[tracking] fbq (${window.fbq ? "queued/sent" : "no stub!"})`,
      ...args,
    );
  }
  window.fbq?.(...args);
}

/** A fresh event id, shared by the browser and server copy of one event. */
export function newEventId(): string {
  return uuid();
}

/** Where the server copies go; the Next rewrite proxies it to the API. */
export const TRACK_ENDPOINT = "/api/track";

/** The events that get a server copy through TRACK_ENDPOINT. Purchase is not
 * one: the order endpoint sends its server copy itself. */
export type TrackedEventName =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout";

/** The only custom_data keys the server accepts — the ones the Pixel sends. */
export type ServerCustomData = {
  content_ids?: string[];
  content_type?: string;
  value?: number;
  currency?: string;
  num_items?: number;
};

/**
 * Report a browser event to the API so it can send the Conversions API twin
 * with the same id. Fire-and-forget: `keepalive` lets the request outlive a
 * navigation or a closed tab, and nothing ever waits on the result.
 */
function postTrack(
  event_name: TrackedEventName,
  event_id: string,
  custom_data?: ServerCustomData,
) {
  if (!pixelActive() || typeof fetch !== "function") return;
  // The Pixel cookies ride along in the body as well as in the Cookie header,
  // so a proxy that strips cookies cannot cost the server copy its match keys.
  const { fbp, fbc } = metaCookies();
  const body = JSON.stringify({
    event_name,
    event_id,
    event_source_url: window.location.href,
    ...(custom_data ? { custom_data } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
  });
  if (debugEnabled()) console.log("[tracking] POST", TRACK_ENDPOINT, body);
  try {
    void fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      // Best effort by design; the browser copy already went out.
    });
  } catch {
    // Same: a throwing fetch (e.g. body too large for keepalive) is ignored.
  }
}

/** PageView for a client-side navigation. The first load is fired by the
 * inline bootstrap; see MetaPixel.tsx. Returns the event id used. */
export function trackPageView(): string {
  const eventID = newEventId();
  fbq("track", "PageView", {}, { eventID });
  postTrack("PageView", eventID);
  return eventID;
}

function pixelContents(items: TrackedItem[]) {
  return {
    content_type: "product",
    content_ids: items.map((item) => item.item_id),
    contents: items.map((item) => ({
      id: item.item_id,
      quantity: item.quantity,
      item_price: item.price,
    })),
    currency: CURRENCY,
  };
}

/** The subset of the Pixel parameters the server copy carries. */
function serverContents(items: TrackedItem[], value: number): ServerCustomData {
  return {
    content_type: "product",
    content_ids: items.map((item) => item.item_id),
    currency: CURRENCY,
    value,
    num_items: items.reduce((n, item) => n + item.quantity, 0),
  };
}

export function trackViewItem(items: TrackedItem[]): string {
  const value = cartValue(items);
  const eventID = newEventId();
  push({
    event: "view_item",
    pageType: "product-page",
    productType: "simple",
    ecommerce: { items, value, currency: CURRENCY },
  });
  fbq(
    "track",
    "ViewContent",
    { ...pixelContents(items), content_name: items[0]?.item_name, value },
    { eventID },
  );
  postTrack("ViewContent", eventID, serverContents(items, value));
  return eventID;
}

export function trackAddToCart(items: TrackedItem[]): string {
  const value = cartValue(items);
  // A fresh id per click: each click is a real intent, and each browser/server
  // pair has to deduplicate on its own.
  const eventID = newEventId();
  push({
    event: "add_to_cart",
    pageType: "product-page",
    productType: "simple",
    ecommerce: { currency: CURRENCY, value, items },
  });
  fbq("track", "AddToCart", { ...pixelContents(items), value }, { eventID });
  postTrack("AddToCart", eventID, serverContents(items, value));
  return eventID;
}

export function trackViewCart(items: TrackedItem[]) {
  push({
    event: "view_cart",
    pageType: "cart",
    ecommerce: { currency: CURRENCY, value: cartValue(items), items },
  });
  // Meta has no standard cart-view event; dataLayer only.
}

export function trackBeginCheckout(items: TrackedItem[]): string {
  const value = cartValue(items);
  const eventID = newEventId();
  const num_items = items.reduce((n, item) => n + item.quantity, 0);
  push({
    event: "begin_checkout",
    pageType: "checkout",
    ecommerce: { currency: CURRENCY, value, items },
  });
  fbq(
    "track",
    "InitiateCheckout",
    { ...pixelContents(items), num_items, value },
    { eventID },
  );
  postTrack("InitiateCheckout", eventID, serverContents(items, value));
  return eventID;
}

export function trackPurchase(input: {
  transactionId: string;
  items: TrackedItem[];
  shipping?: number;
  user: Partial<UserData>;
}) {
  const items = input.items;
  const shipping = input.shipping ?? SHIPPING;
  const value = cartValue(items) + shipping;
  const user_data: UserData = {
    first_name: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    region: "",
    postal_code: "",
    country: "BD",
    ...input.user,
  };
  push({
    event: "purchase",
    pageType: "order-received",
    ecommerce: {
      transaction_id: input.transactionId,
      value,
      tax: 0,
      shipping,
      currency: CURRENCY,
      items,
    },
    new_customer: true,
    user_data,
  });
  fbq(
    "track",
    "Purchase",
    { ...pixelContents(items), value, num_items: items.length },
    { eventID: input.transactionId },
  );
}

/** Normalises a Bangladeshi phone number to E.164 for Meta advanced matching. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("880")) return `+${digits}`;
  if (digits.startsWith("0")) return `+880${digits.slice(1)}`;
  return digits ? `+880${digits}` : "";
}
