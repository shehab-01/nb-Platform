// What the admin knows about each template: a name, a line about it and a
// preview. Kept apart from the registry (index.ts) so the Templates page can
// list every template without pulling any template's components into the
// admin bundle. Every key here must exist in the registry and vice versa;
// the registry test enforces it.

/** A picture the template shows that a store may replace with its own. */
export type ContentField = {
  key: string;
  label: string;
  /** Path under /public: what shows until the store uploads its own. */
  defaultUrl: string;
  /** Guidance for the upload, e.g. "1146×672, JPG". */
  size: string;
};

export type TemplateInfo = {
  /** The value stored in `stores.template`. */
  id: string;
  name: string;
  description: string;
  /** Path under /public. */
  preview: string;
  highlights: string[];
  content: ContentField[];
};

const LOGO: ContentField = {
  key: "logo",
  label: "Logo",
  defaultUrl: "/logo.png",
  size: "about 300×96, transparent PNG",
};

export const TEMPLATE_CATALOG: Record<string, TemplateInfo> = {
  classic: {
    id: "classic",
    name: "Bazar Classic",
    description:
      "One product, one page. The original Nature Bazar landing page: product card, size picker, order summary and a cash-on-delivery form in a single mobile column.",
    preview: "/templates/classic.png",
    highlights: [
      "Single live product with variants",
      "Bangla copy, mobile-first",
      "Abandoned-form capture",
      "Meta Pixel + Conversions API events",
    ],
    content: [LOGO],
  },
  campaign: {
    id: "campaign",
    name: "Bazar Campaign",
    description:
      "Bazar Classic with a campaign on top: a hero banner, how-to-participate strip, prizes, product showcase and offer price above the same size picker and order form.",
    preview: "/templates/campaign.png",
    highlights: [
      "Everything in Bazar Classic",
      "Banner, prizes and offer pictures",
      "Each picture replaceable per store",
    ],
    content: [
      LOGO,
      { key: "banner", label: "Hero banner", defaultUrl: "/campaign.jpg", size: "1146×672, JPG" },
      { key: "how_it_works", label: "How to participate", defaultUrl: "/how-it-works.jpeg", size: "812×232, JPG" },
      { key: "prizes", label: "Prizes", defaultUrl: "/prizes.jpg", size: "877×877, JPG" },
      { key: "products", label: "Product showcase", defaultUrl: "/products.jpg", size: "1120×450, JPG" },
      { key: "offer_price", label: "Offer price badge", defaultUrl: "/offer-price.png", size: "180×120, PNG" },
    ],
  },
};

/**
 * Every content key the template declares, mapped to the store's own picture
 * when it has one and the template default otherwise. Keys the template does
 * not declare are dropped, so a template switch never shows a stale upload.
 */
export function resolveContent(
  templateId: string,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const info = TEMPLATE_CATALOG[templateId] ?? TEMPLATE_CATALOG.classic;
  const out: Record<string, string> = {};
  for (const field of info.content) {
    out[field.key] = overrides?.[field.key] || field.defaultUrl;
  }
  return out;
}

export function templateInfo(id: string): TemplateInfo {
  return (
    TEMPLATE_CATALOG[id] ?? {
      id,
      name: id,
      description: "Unknown template",
      preview: "",
      highlights: [],
      content: [],
    }
  );
}
