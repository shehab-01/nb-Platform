// What the admin knows about each template: a name, a line about it and a
// preview. Kept apart from the registry (index.ts) so the Templates page can
// list every template without pulling any template's components into the
// admin bundle. Every key here must exist in the registry and vice versa;
// the registry test enforces it.

/** A picture the template shows that a store may replace with its own. */
export type ContentField = {
  key: string;
  label: string;
  /** Path under /public: what shows until the store uploads its own. Empty
   * for an optional picture: nothing shows until one is uploaded. */
  defaultUrl: string;
  /** Guidance for the upload, e.g. "1146×672 · JPG". */
  size: string;
  /** One line on where this picture shows up, for the upload row. */
  hint: string;
  group?: string;
};

/* Any field may name a `group`: the store form edits a group's pictures,
   texts and colours together in one card titled by it (a page section's
   picture, title and title colour). Ungrouped fields go in the form's
   Pictures and Text & colours cards. */

/** A line of the template's copy a store may reword. Stored in the store's
 * theme under `key`; empty means the default. */
export type TextField = {
  key: string;
  label: string;
  defaultValue: string;
  maxLength: number;
  hint: string;
  /** What the empty input says, when the default is not a fixed text (an
   * empty default means the page decides, e.g. the product's own title). */
  placeholder?: string;
  group?: string;
};

/** A colour of the template a store may change. Stored in the store's theme
 * under `key` as "#rrggbb"; anything else means the default. */
export type ColorField = {
  key: string;
  label: string;
  defaultValue: string;
  hint: string;
  group?: string;
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
  /** Copy and colours the store may change; most templates have none. */
  texts: TextField[];
  colors: ColorField[];
  /** True when the template has no size picker and sells only the live
   * product's default variant. The store form warns before switching a
   * multi-variant store onto such a template. */
  singleVariant: boolean;
};

const LOGO: ContentField = {
  key: "logo",
  label: "Logo",
  defaultUrl: "/logo.png",
  size: "300×96 · PNG",
  hint: "Transparent background, sits on the dark header",
};

/** The pictures both campaign templates show, in page order. */
const CAMPAIGN_PICTURES: ContentField[] = [
  LOGO,
  {
    key: "banner",
    label: "Hero banner",
    defaultUrl: "/campaign.jpg",
    size: "1146×672 · JPG",
    hint: "First thing shoppers see at the top of the page",
  },
  {
    key: "how_it_works",
    label: "How to participate",
    defaultUrl: "/how-it-works.jpeg",
    size: "812×232 · JPG",
    hint: "Four-step strip explaining the campaign",
  },
  {
    key: "prizes",
    label: "Prizes",
    defaultUrl: "/prizes.jpg",
    size: "877×877 · JPG",
    hint: "Square prize board",
  },
  {
    key: "products",
    label: "Product showcase",
    defaultUrl: "/products.jpg",
    size: "1120×450 · JPG",
    hint: "Wide product row below the prizes",
  },
  {
    key: "offer_price",
    label: "Offer price badge",
    defaultUrl: "/offer-price.png",
    size: "180×120 · PNG",
    hint: "Small badge shown beside the price",
  },
];

/** Extra hero banners for Bazar Campaign Gold. The banner and these rotate
 * on their own at the top of the page; an empty one is simply left out. */
export const EXTRA_BANNER_KEYS = ["banner_2", "banner_3", "banner_4", "banner_5"];

const GOLD_PICTURES: ContentField[] = CAMPAIGN_PICTURES.flatMap((field) =>
  field.key !== "banner"
    ? [field]
    : [
        { ...field, hint: "First banner of the slider at the top of the page" },
        ...EXTRA_BANNER_KEYS.map((key, i) => ({
          key,
          label: `Hero banner ${i + 2}`,
          defaultUrl: "",
          size: field.size,
          hint: "Optional. Same size and style as the first; the banners take turns on their own",
        })),
      ],
);

/** Gold's two headline lines, written per store. */
const GOLD_TEXTS: TextField[] = [
  {
    key: "headline",
    label: "Headline",
    defaultValue: "ফাইনাল ড্র",
    maxLength: 40,
    hint: "First line of the big gold headline under the banner",
  },
  {
    key: "draw_date",
    label: "Draw date",
    defaultValue: "অক্টোবর ৩০ তারিখ",
    maxLength: 40,
    hint: "Second headline line. Keep it short so it fits one line on a phone",
  },
];

/** Bazar Gold Custom's sections below the intro, in page order: a title
 * over a picture. Each is optional and shows only once its picture is
 * uploaded. The picture keys are Gold's, so uploads carry over. */
export const CUSTOM_SECTIONS = [
  { key: "how_it_works", group: "Section 01", title: "কিভাবে অংশগ্রহণ করবেন?" },
  { key: "prizes", group: "Section 02", title: "পুরস্কার সমূহ" },
  { key: "products", group: "Section 03", title: "আমাদের স্পেশাল আচার কম্বো" },
];

const CUSTOM_PICTURES: ContentField[] = [
  ...GOLD_PICTURES.filter((field) => field.key === "logo" || field.key.startsWith("banner")),
  ...CUSTOM_SECTIONS.map(({ key, group }) => {
    const field = CAMPAIGN_PICTURES.find((f) => f.key === key)!;
    return {
      ...field,
      // Names its section: the store's Content page lists pictures ungrouped.
      label: `${group} picture`,
      defaultUrl: "",
      hint: "Optional. Until a picture is uploaded the whole section stays off the page",
      group,
    };
  }),
];

const CUSTOM_TEXTS: TextField[] = [
  {
    key: "kicker",
    label: "Kicker",
    defaultValue: "নেচার বাজার মিলিয়নিয়ার ক্যাম্পেইন",
    maxLength: 60,
    hint: "The small line above the headline",
  },
  ...GOLD_TEXTS,
  {
    key: "intro",
    label: "Intro",
    defaultValue:
      "স্পেশাল আচার কম্বো অর্ডার করে অংশ নিন দশ লাখ টাকা ক্যাশ ও এক হাজার+ গিফট আইটেমের ক্যাম্পেইনে।",
    maxLength: 200,
    hint: "The sentence under the headline, above the order button",
  },
  ...CUSTOM_SECTIONS.map(({ key, group, title }) => ({
    key: `${key}_title`,
    label: "Title",
    defaultValue: title,
    maxLength: 60,
    hint: "Above the picture",
    group,
  })),
];

const CUSTOM_COLORS: ColorField[] = [
  // Same keys as Bazar Spotlight's, so the colours carry over between them.
  { key: "nav_color", label: "Header colour", defaultValue: "#05200f", hint: "The bar with the logo" },
  { key: "body_color", label: "Page colour", defaultValue: "#0a3b22", hint: "The green ground behind everything" },
  { key: "footer_color", label: "Footer colour", defaultValue: "#05200f", hint: "The bar at the bottom" },
  { key: "kicker_color", label: "Kicker colour", defaultValue: "#d9a537", hint: "The small line above the headline" },
  ...CUSTOM_SECTIONS.map(({ key, group }) => ({
    key: `${key}_title_color`,
    label: "Title colour",
    defaultValue: "#f7f1e3",
    hint: "The title above the picture",
    group,
  })),
];

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
    texts: [],
    colors: [],
    singleVariant: false,
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
    content: CAMPAIGN_PICTURES,
    texts: [],
    colors: [],
    singleVariant: true,
  },
  campaign2: {
    id: "campaign2",
    name: "Bazar Campaign Gold",
    description:
      "The same campaign on a deep green ground with gold: banner and pitch first, a pulsing order button, sections that fade in as you scroll, and the order form as a cream receipt card.",
    preview: "/templates/campaign2.png",
    highlights: [
      "Dark green and gold, built to impress on a phone",
      "Pulsing order button, scroll-in sections",
      "Same pictures as Bazar Campaign",
      "Headline and draw date written per store",
      "Up to five hero banners that slide on their own",
    ],
    content: GOLD_PICTURES,
    texts: GOLD_TEXTS,
    colors: [],
    singleVariant: true,
  },
  campaign3: {
    id: "campaign3",
    name: "Bazar Gold Custom",
    description:
      "Bazar Campaign Gold with more of it the store's to set: header, page and footer colours, the kicker and intro lines, and three sections, each with its own title and colour and each left off until its picture is uploaded.",
    // No screenshot of its own yet: it looks like Gold until changed.
    preview: "/templates/campaign2.png",
    highlights: [
      "Everything in Bazar Campaign Gold, minus the offer badge",
      "Header, page and footer colours",
      "Kicker, headline, draw date and intro written per store",
      "Optional sections, each with its own title, colour and picture",
    ],
    content: CUSTOM_PICTURES,
    texts: CUSTOM_TEXTS,
    colors: CUSTOM_COLORS,
    singleVariant: true,
  },
  spotlight: {
    id: "spotlight",
    name: "Bazar Spotlight",
    description:
      "Bazar Classic with one product picture of the store's own: it stays the same whichever size is picked. The product title, the picker's heading and the header and footer colours are the store's to set.",
    preview: "/templates/spotlight.png",
    highlights: [
      "Everything in Bazar Classic, size picker included",
      "One uploaded product picture for every size",
      "Product title and picker heading written per store",
      "Header and footer colours",
    ],
    content: [
      LOGO,
      {
        // Key kept from when this was a banner, so uploads carry over.
        key: "spotlight",
        label: "Product picture",
        // Not shown on the page: until the store uploads one, the card
        // shows the picked size's own picture (the logo when it has none).
        defaultUrl: "/logo.png",
        size: "1120×1120 · JPG",
        hint: "On the product card for every size. Until uploaded, the picked size's picture shows",
      },
    ],
    texts: [
      {
        key: "product_title",
        label: "Product title",
        defaultValue: "",
        maxLength: 120,
        hint: "The big title on the product card. Empty: the picked size's own title",
        placeholder: "The picked size's title",
      },
      {
        key: "pick_heading",
        label: "Picker heading",
        defaultValue: "কত প্যাকেট নিতে চান সিলেক্ট করুন",
        maxLength: 120,
        hint: "Above the sizes to pick from",
      },
    ],
    colors: [
      { key: "nav_color", label: "Header colour", defaultValue: "#043d22", hint: "The bar with the logo" },
      { key: "footer_color", label: "Footer colour", defaultValue: "#05200f", hint: "The card at the bottom" },
    ],
    singleVariant: false,
  },
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** "#1a9c4d" is a colour a store may save; anything else is not. */
export function isHexColor(value: string | undefined): value is string {
  return value !== undefined && HEX_RE.test(value);
}

/**
 * Every text and colour key the template declares, mapped to the store's
 * value (from its theme) when it has a usable one and the default otherwise.
 * A colour that is not "#rrggbb" falls back too: it ends up in a style
 * attribute, so only that one shape is let through.
 */
export function resolveOptions(
  templateId: string,
  theme: Record<string, string> | undefined,
): Record<string, string> {
  const info = TEMPLATE_CATALOG[templateId] ?? TEMPLATE_CATALOG.classic;
  const out: Record<string, string> = {};
  for (const field of info.texts) {
    const value = theme?.[field.key]?.trim();
    out[field.key] = value ? value.slice(0, field.maxLength) : field.defaultValue;
  }
  for (const field of info.colors) {
    const value = theme?.[field.key];
    out[field.key] = isHexColor(value) ? value.toLowerCase() : field.defaultValue;
  }
  return out;
}


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
      texts: [],
      colors: [],
      singleVariant: false,
    }
  );
}
