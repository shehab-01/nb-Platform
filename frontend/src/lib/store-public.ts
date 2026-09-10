// The store's public configuration as the browser sees it. The storefront
// layout serialises it into <script id="nb-store" type="application/json">
// per request, so the pixel id and friends are runtime values from the
// database rather than constants baked into the build. On pages without the
// script (the admin, the preview) everything is empty and tracking is off.

export type PublicStoreConfig = {
  slug: string;
  currency: string;
  pixelId: string;
  gtmId: string;
};

export const STORE_SCRIPT_ID = "nb-store";

const EMPTY: PublicStoreConfig = { slug: "", currency: "BDT", pixelId: "", gtmId: "" };

let cached: PublicStoreConfig | null = null;

export function publicStoreConfig(): PublicStoreConfig {
  if (cached) return cached;
  if (typeof document === "undefined") return EMPTY;
  const el = document.getElementById(STORE_SCRIPT_ID);
  if (!el?.textContent) return EMPTY;
  try {
    const raw = JSON.parse(el.textContent) as Partial<PublicStoreConfig>;
    cached = {
      slug: raw.slug ?? "",
      currency: raw.currency ?? "BDT",
      pixelId: raw.pixelId ?? "",
      gtmId: raw.gtmId ?? "",
    };
  } catch {
    cached = EMPTY;
  }
  return cached;
}

/** Tests swap the page's config between cases. */
export function resetPublicStoreConfig(): void {
  cached = null;
}
