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

/** Returned out of everything confirmed. */
export function returnRate(f: Figures): string {
  return f.confirmed ? `${Math.round((f.returned / f.confirmed) * 100)}%` : "—";
}

export function bdt(n: number): string {
  return `৳${n.toLocaleString("en-IN")}`;
}
