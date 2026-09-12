import { CURRENCY, type TrackedItem } from "@/lib/tracking";

/** One version of a product — a size, a pack — as the admin sees it. */
export type Variant = {
  id: number;
  productId: number;
  /** "২ কেজি". Empty on rows from before versions existed. */
  label: string;
  imageUrl: string | null;
  defaultQuantity: number;
  unitPrice: number;
  sku: string;
  isDefault: boolean;
};

/** A catalogue row as the admin sees it: the group, with its versions. */
export type Product = {
  id: number;
  title: string;
  description: string;
  isActive: boolean;
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
};

/**
 * The name an order, the picker and the page heading show: the product and
 * its size, or just the product on a version that has no label. Mirrors
 * catalogue.variant_title on the API, so the admin previews what the order
 * will record.
 */
export function variantTitle(productTitle: string, label: string): string {
  return label ? `${productTitle} — ${label}` : productTitle;
}

/**
 * What the old storefront sells — no row id, no timestamps. This is what
 * prices its order table and feeds its analytics events.
 */
export type StorefrontProduct = {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  defaultQuantity: number;
  unitPrice: number;
  sku: string;
};

/**
 * One entry in the landing page's size picker. A StorefrontProduct so the
 * success card and the analytics helpers take it as they are, plus the id the
 * order sends back so the API prices the size that was chosen.
 */
export type StorefrontVariant = StorefrontProduct & {
  id: number;
  label: string;
  isDefault: boolean;
  /** The upload's resized WebP copies ("…-w480.webp 480w, …"), or null when
   * there are none yet; the page then shows imageUrl alone. */
  imageSrcset: string | null;
  /** The original's pixel size, so the box is reserved before it loads. */
  imageWidth: number | null;
  imageHeight: number | null;
};

/** The landing page's whole offer: the active product and its sizes. */
export type StorefrontListing = {
  title: string;
  description: string;
  variants: StorefrontVariant[];
};

/**
 * The product image, or the logo when none has been uploaded. Callers that
 * frame the picture check imageUrl themselves, since the logo wants a dark
 * ground and room around it rather than a photo's edge-to-edge crop.
 */
export function productImage(product: StorefrontProduct): string {
  return product.imageUrl ?? "/logo.png";
}

/**
 * The product as GA4/Meta want it. Built from the live product rather than a
 * constant, so a price change in the admin cannot leave the analytics events
 * reporting the old one.
 */
export function trackedItem(product: StorefrontProduct): TrackedItem {
  return {
    id: product.sku,
    item_id: product.sku,
    item_name: product.title,
    currency: CURRENCY,
    price: product.unitPrice,
    item_category: "সারা বাংলাদেশে ফ্রি ডেলিভারি",
    quantity: 1,
  };
}
