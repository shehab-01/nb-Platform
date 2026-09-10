// The contract every storefront template fulfils. A template is a folder
// under src/templates/<name>/ exporting one TemplateModule; the registry in
// ./index.ts is the only place that knows the names. Templates get typed
// props and import only storefront-safe modules (lib/storefront-api,
// lib/tracking, lib/products) — never lib/api (the admin client).

import type { ReactNode } from "react";

import type { StorefrontListing } from "@/lib/products";

/** What a template may know about the store it renders. No secrets. */
export type StorePublicConfig = {
  slug: string;
  name: string;
  currency: string;
  /** CSS custom properties derived from the store's theme; the template
   * decides which of its own variables they feed. */
  themeVars: Record<string, string>;
  /** Picture URLs by field key, the store's own or the template default,
   * resolved for this template (templates/catalog.resolveContent). Every key
   * the template declares is present. */
  content: Record<string, string>;
};

export type StorefrontProps = {
  store: StorePublicConfig;
  listing: StorefrontListing;
};

export type ClosedProps = {
  store: StorePublicConfig;
};

export type TemplateModule = {
  /** The selling page: the live product with its variants and the form. */
  Storefront: (props: StorefrontProps) => ReactNode;
  /** The store with nothing live. */
  Closed: (props: ClosedProps) => ReactNode;
};
