import type { Metadata } from "next";

import "@/templates/classic/landing.css";
import type { StorefrontListing } from "@/lib/products";
import { getStoreBySlug, themeVars } from "@/lib/store";
import { fetchStorefrontListing } from "@/lib/storefront-api";
import { PreviewClient } from "@/app/preview/preview-client";
import { resolveTemplateName } from "@/templates";
import { resolveContent } from "@/templates/catalog";
import type { StorePublicConfig } from "@/templates/types";

/**
 * Renders a template on its own, for the iframe beside the store form in the
 * admin. `?template=<id>&name=<store name>` shows the template with sample
 * data; add `&store=<slug>` to show a real store's live catalogue instead.
 * Nothing here is secret (the storefront is public), so there is no auth;
 * search engines are told to stay away and the proxy only serves it on the
 * admin host.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Template preview",
  robots: { index: false, follow: false },
};

const SAMPLE: StorefrontListing = {
  title: "Your product",
  description:
    "This is where the product description goes. Replace it in Admin → Products once the store exists.",
  variants: [
    {
      id: 0,
      title: "Your product — 1 kg",
      label: "1 kg",
      subtitle: "",
      imageUrl: null,
      defaultQuantity: 1,
      unitPrice: 1250,
      sku: "SAMPLE-1KG",
      isDefault: true,
    },
    {
      id: 0,
      title: "Your product — 500 g",
      label: "500 g",
      subtitle: "",
      imageUrl: null,
      defaultQuantity: 1,
      unitPrice: 700,
      sku: "SAMPLE-500G",
      isDefault: false,
    },
  ],
};

type Search = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function PreviewPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const templateName = resolveTemplateName(first(params.template) || null);
  const slug = first(params.store);
  let name = first(params.name).trim() || "Store name";

  let listing: StorefrontListing | null = SAMPLE;
  let theme: Record<string, string> = {};
  let content: Record<string, string> = {};
  if (slug) {
    // A real store: its live catalogue and its own pictures, so the preview
    // is exactly what customers see (the template can still be overridden
    // by ?template= to try another one on the same data).
    const real = await getStoreBySlug(slug);
    if (real) {
      listing = await fetchStorefrontListing({ "x-store-slug": slug });
      theme = real.theme;
      content = real.content;
      name = real.name;
    }
  }

  const store: StorePublicConfig = {
    slug: slug || "preview",
    name,
    currency: "BDT",
    themeVars: themeVars(theme),
    content: resolveContent(templateName, content),
  };
  // Rendered on the client so the store form can swap pictures live; the
  // order form is inert there (pointer events off).
  return <PreviewClient templateName={templateName} store={store} listing={listing} />;
}
