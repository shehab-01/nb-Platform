// How a store records production: which Production pages it gets. Picked
// per store by a super admin on the store form, the way a storefront template
// is. Each mode is its own set of pages and its own API; the list page loads
// only the store's. Keep in step with PRODUCTION_MODES in
// backend/api/routers/stores.py.

export const PRODUCTION_MODES = [
  {
    id: "cooking",
    name: "Cooking by day",
    description: "One production a day: cooks, bazar list, patils and jars.",
  },
  {
    id: "batch",
    name: "Batch order",
    description:
      "An order of so many packets, bought for up front and received in slots, each with its own invoice.",
  },
] as const;

export type ProductionMode = (typeof PRODUCTION_MODES)[number]["id"];

/** The mode's entry, or cooking for a value this build does not know. */
export function productionMode(id: string | null | undefined): (typeof PRODUCTION_MODES)[number] {
  return PRODUCTION_MODES.find((m) => m.id === id) ?? PRODUCTION_MODES[0];
}
