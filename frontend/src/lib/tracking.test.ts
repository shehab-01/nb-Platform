import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { STORE_SCRIPT_ID, resetPublicStoreConfig } from "@/lib/store-public";
import type { TrackedItem } from "@/lib/tracking";

type Tracking = typeof import("@/lib/tracking");
let tracking: Tracking;

/** The page's store config, as the storefront layout serialises it. */
function setStoreConfig(pixelId: string) {
  document.getElementById(STORE_SCRIPT_ID)?.remove();
  const el = document.createElement("script");
  el.id = STORE_SCRIPT_ID;
  el.type = "application/json";
  el.textContent = JSON.stringify({ slug: "s", currency: "BDT", pixelId, gtmId: "" });
  document.head.appendChild(el);
  resetPublicStoreConfig();
}

const ITEM: TrackedItem = {
  id: "SKU-1",
  item_id: "SKU-1",
  item_name: "Honey 1kg",
  currency: "BDT",
  price: 1490,
  item_category: "food",
  quantity: 1,
};

const fbq = vi.fn();
const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

function lastTrackPost() {
  const call = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url: call[0], init: call[1], body: JSON.parse(String(call[1].body)) };
}

beforeAll(async () => {
  tracking = await import("@/lib/tracking");
});

beforeEach(() => {
  setStoreConfig("424242");
  window.history.replaceState({}, "", "/");
  window.fbq = fbq;
  vi.stubGlobal("fetch", fetchMock);
  fbq.mockClear();
  fetchMock.mockClear();
  document.cookie = "_fbp=fb.1.1700000000000.1234567890; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("eventID is shared by the fbq call and the /api/track post", () => {
  it.each([
    ["ViewContent", (t: Tracking) => t.trackViewItem([ITEM])],
    ["AddToCart", (t: Tracking) => t.trackAddToCart([ITEM])],
    ["InitiateCheckout", (t: Tracking) => t.trackBeginCheckout([ITEM])],
    ["PageView", (t: Tracking) => t.trackPageView()],
  ])("%s", (name, fire) => {
    const id = fire(tracking);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const pixelCall = fbq.mock.calls.find((c) => c[0] === "track" && c[1] === name);
    expect(pixelCall).toBeDefined();
    expect(pixelCall![3]).toEqual({ eventID: id });

    const { url, init, body } = lastTrackPost();
    expect(url).toBe(tracking.TRACK_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(body.event_name).toBe(name);
    expect(body.event_id).toBe(id);
    expect(body.event_source_url).toBe(window.location.href);
    expect(body.fbp).toBe("fb.1.1700000000000.1234567890");
  });

  it("gives every AddToCart click its own id", () => {
    const a = tracking.trackAddToCart([ITEM]);
    const b = tracking.trackAddToCart([ITEM]);
    expect(a).not.toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends only the whitelisted custom_data keys to the server", () => {
    tracking.trackViewItem([{ ...ITEM, quantity: 2 }]);
    const { body } = lastTrackPost();
    expect(body.custom_data).toEqual({
      content_type: "product",
      content_ids: ["SKU-1"],
      currency: "BDT",
      value: 2980,
      num_items: 2,
    });
    expect(Object.keys(body).sort()).toEqual(
      ["custom_data", "event_id", "event_name", "event_source_url", "fbp"].sort(),
    );
  });

  it("Purchase keeps the order number as eventID and has no /api/track copy", () => {
    tracking.trackPurchase({ transactionId: "NB-42", items: [ITEM], user: {} });
    const purchase = fbq.mock.calls.find((c) => c[1] === "Purchase");
    expect(purchase![3]).toEqual({ eventID: "NB-42" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("gating", () => {
  it("calls the stub even before fbevents.js has loaded", () => {
    // The stub queues; the wrapper must not check for a 'loaded' SDK.
    const stub = vi.fn();
    window.fbq = stub;
    tracking.trackAddToCart([ITEM]);
    expect(stub).toHaveBeenCalledOnce();
  });

  it("does nothing on admin pages", () => {
    window.history.replaceState({}, "", "/admin/orders");
    tracking.trackPageView();
    tracking.trackAddToCart([ITEM]);
    expect(fbq).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when fetch rejects", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    expect(() => tracking.trackAddToCart([ITEM])).not.toThrow();
    await Promise.resolve();
  });
});


describe("runtime pixel id", () => {
  it("is read from the page, not from the build", () => {
    expect(tracking.pixelId()).toBe("424242");
    setStoreConfig("");
    expect(tracking.pixelId()).toBe("");
    fbq.mockClear();
    tracking.trackPageView();
    expect(fbq).not.toHaveBeenCalled();
  });
});
