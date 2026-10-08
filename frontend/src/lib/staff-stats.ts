import type { StaffDayStats, StaffMember } from "@/lib/api";

// --- Months, the shop's way --------------------------------------------------
// YYYY-MM and YYYY-MM-DD strings that mean Dhaka calendar days; arithmetic is
// done in UTC so a viewer's own timezone never moves a day boundary.

export function dhakaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}

export function shiftMonth(month: string, n: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// --- Figures -----------------------------------------------------------------

export type Figures = Omit<StaffDayStats, "user_id" | "day">;

export const ZERO: Figures = {
  handled: 0,
  no_response: 0,
  cancelled: 0,
  confirmed: 0,
  from_incomplete: 0,
  delivered: 0,
  returned: 0,
  in_transit: 0,
};

export function sum(rows: Figures[]): Figures {
  const out = { ...ZERO };
  for (const r of rows) {
    for (const k of Object.keys(out) as (keyof Figures)[]) out[k] += r[k];
  }
  return out;
}

export function staffName(s: StaffMember | undefined): string {
  return s ? s.nickname || s.name : "Unknown";
}

// --- Incentive ---------------------------------------------------------------

/** A day's bonus by orders delivered, highest tier first. Delivered is
 *  credited to the day the order was confirmed, so a day's incentive keeps
 *  rising for a few days as its parcels arrive. 200+ is the ceiling. */
export const INCENTIVE_TIERS: { delivered: number; bdt: number }[] = [
  { delivered: 200, bdt: 3000 },
  { delivered: 150, bdt: 1750 },
  { delivered: 100, bdt: 1000 },
];

export function incentiveFor(delivered: number): number {
  return INCENTIVE_TIERS.find((t) => delivered >= t.delivered)?.bdt ?? 0;
}

/** Returned out of the parcels that finished their trip (delivered +
 *  returned) — 80 delivered and 20 returned is 20% — as a whole percentage
 *  rounded UP, 18.1% being 19%; that whole number is what the incentive
 *  tiers judge. The same rule as the delivery team's, so orders cancelled
 *  before shipping or still on the road neither help nor hurt. Whole-number
 *  division, so an exactly whole rate (9 of 50 → 18) is never pushed up a
 *  point by float error. null with nothing finished. */
export function returnPct(f: Figures): number | null {
  const finished = f.delivered + f.returned;
  return finished ? Math.ceil((f.returned * 100) / finished) : null;
}

export function returnRate(f: Figures): string {
  const pct = returnPct(f);
  return pct === null ? "—" : `${pct}%`;
}

/** How much of the month's earned incentive is paid, by the month's return
 *  rate (rounded up, as above), strictest first. */
export const RETURN_PENALTY: {
  label: string;
  /** The same, in Bangla, for the rule shown on the Incentive page. */
  labelBn: string;
  from: number;
  share: number;
}[] = [
  { label: "25% or more", labelBn: "25% বা বেশি", from: 25, share: 0 },
  { label: "20% to 24%", labelBn: "20% থেকে 24%", from: 20, share: 0.25 },
  { label: "19%", labelBn: "19%", from: 19, share: 0.5 },
  { label: "Up to 18%", labelBn: "18% পর্যন্ত", from: 0, share: 1 },
];

export function returnTier(f: Figures) {
  const pct = returnPct(f) ?? 0;
  return RETURN_PENALTY.find((t) => pct >= t.from)!;
}

export function payableShare(f: Figures): number {
  return returnTier(f).share;
}

export function bdt(n: number): string {
  return `৳${n.toLocaleString("en-IN")}`;
}
