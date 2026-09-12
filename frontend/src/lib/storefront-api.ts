// Everything the public storefront is allowed to call. Kept apart from the
// admin client on purpose: this is the only API module the landing page
// bundle contains, so there is no order-listing code in it to find, and no
// admin weight on a page whose only job is converting.

import { request } from "@/lib/http";
import type { StorefrontListing, StorefrontProduct } from "@/lib/products";

/** Headers naming the store a server-side call is for (lib/store.storeHeaders).
 * Passed in rather than read here: this module is also bundled into the
 * browser, where next/headers does not exist. */
export type StoreHeaders = Record<string, string>;

export async function createOrder(input: {
  customerName: string;
  phone: string;
  address: string;
  quantity?: number;
  draftKey?: string;
  // The size picked on the landing page. Only the id goes over: the API
  // reads the name and price from that row, never from the browser.
  variantId?: number | null;
  note?: string;
}): Promise<{ orderNo: string }> {
  const order = await request<{ order_no: string }>("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customer_name: input.customerName,
      phone: input.phone,
      address: input.address,
      quantity: input.quantity ?? 1,
      draft_key: input.draftKey ?? null,
      variant_id: input.variantId ?? null,
      note: input.note ?? "",
    }),
  });
  return { orderNo: order.order_no };
}

/**
 * Autosave a storefront form that has not been submitted yet, so the lead
 * reaches the admin Incomplete list even if the visitor never presses order.
 * Best-effort by design: a failure must never disturb the person filling it.
 *
 * `keepalive` lets the last save survive the page being closed, which is
 * exactly when an abandoned form matters most.
 */
export type DraftSaveResult = "saved" | "throttled" | "failed";

export async function saveOrderDraft(input: {
  draftKey: string;
  customerName: string;
  phone: string;
  address: string;
}): Promise<DraftSaveResult> {
  try {
    const res = await fetch("/api/orders/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        draft_key: input.draftKey,
        customer_name: input.customerName,
        phone: input.phone,
        address: input.address,
      }),
    });
    // 429 is the API asking us to slow down; the caller pauses autosaving.
    if (res.status === 429) return "throttled";
    return res.ok ? "saved" : "failed";
  } catch {
    // Offline or blocked: the next keystroke or the next visit tries again.
    return "failed";
  }
}


/**
 * The product the old storefront sells, read on the server so the page
 * renders with a price already in it — no flash of a stale number, and the
 * markup a crawler sees is the real offer.
 *
 * Called from a server component, so it talks to the API directly rather than
 * through the browser-relative "/api" rewrite. Null when nothing is live or
 * the API cannot be reached: there is no bundled product to fall back to,
 * because selling something nobody put in the catalogue is worse than
 * selling nothing.
 */
export async function fetchActiveProduct(
  store: StoreHeaders = {},
): Promise<StorefrontProduct | null> {
  const base = process.env.API_URL ?? "http://api:8000";
  try {
    const res = await fetch(`${base}/api/storefront/product`, {
      headers: store,
      // Always current: a super admin who edits the product expects to see it
      // on the next reload, not a minute later.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title: string;
      subtitle: string;
      image_url: string | null;
      default_quantity: number;
      unit_price: number;
      sku: string;
    };
    return {
      title: data.title,
      subtitle: data.subtitle,
      imageUrl: data.image_url,
      defaultQuantity: data.default_quantity,
      unitPrice: data.unit_price,
      sku: data.sku,
    };
  } catch {
    return null;
  }
}

type ListingJson = {
  title: string;
  description: string;
  variants: {
    id: number;
    title: string;
    label: string;
    image_url: string | null;
    image_srcset: string | null;
    image_width: number | null;
    image_height: number | null;
    default_quantity: number;
    unit_price: number;
    sku: string;
    is_default: boolean;
  }[];
};

/**
 * The landing page's offer — the live product, its description and its
 * sizes — read on the server for the same reasons as fetchActiveProduct.
 * Null when nothing is live or the API is down; the page then says the shop
 * is closed for the moment rather than selling from a constant.
 */
export async function fetchStorefrontListing(
  store: StoreHeaders = {},
): Promise<StorefrontListing | null> {
  const base = process.env.API_URL ?? "http://api:8000";
  try {
    const res = await fetch(`${base}/api/storefront/listing`, {
      // Which store's catalogue (once the catalogue is per store).
      headers: store,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ListingJson;
    if (data.variants.length === 0) return null;
    return {
      title: data.title,
      description: data.description,
      variants: data.variants.map((row) => ({
        id: row.id,
        title: row.title,
        label: row.label,
        subtitle: "",
        imageUrl: row.image_url,
        imageSrcset: row.image_srcset ?? null,
        imageWidth: row.image_width ?? null,
        imageHeight: row.image_height ?? null,
        defaultQuantity: row.default_quantity,
        unitPrice: row.unit_price,
        sku: row.sku,
        isDefault: row.is_default,
      })),
    };
  } catch {
    return null;
  }
}
