// The delivery team's monthly incentive: one amount for the whole team, read
// off a grid of parcels delivered against return rate.

/** Rows, highest first: the first whose `from` the month's delivered count
 *  reaches. Under 5,000 delivered earns nothing. */
export const DELIVERED_TIERS = [20000, 15000, 10000, 5000];

/** Columns, by the return rate rounded up to a whole percent: the first
 *  whose `upTo` the rate does not pass. Over 20% earns nothing. */
export const RATE_BANDS: { upTo: number; label: string; labelBn: string }[] = [
  { upTo: 15, label: "Up to 15%", labelBn: "15% পর্যন্ত" },
  { upTo: 18, label: "16% to 18%", labelBn: "16% থেকে 18%" },
  { upTo: 20, label: "19% to 20%", labelBn: "19% থেকে 20%" },
];

/** BDT, indexed [delivered tier][rate band]. */
export const TEAM_GRID: number[][] = [
  [300000, 150000, 50000],
  [150000, 75000, 25000],
  [75000, 25000, 7500],
  [50000, 12500, 5500],
];

/** Returned out of every parcel that finished (delivered + returned), rounded
 *  UP to a whole percent; null with nothing finished. Whole-number division,
 *  so an exact 15% stays 15%. */
export function teamReturnPct(delivered: number, returned: number): number | null {
  const finished = delivered + returned;
  return finished ? Math.ceil((returned * 100) / finished) : null;
}

/** Which cell of the grid applies; either index is -1 when the month is
 *  under the first tier or over the last band. */
export function teamCell(delivered: number, returned: number): { row: number; col: number } {
  const row = DELIVERED_TIERS.findIndex((from) => delivered >= from);
  const pct = teamReturnPct(delivered, returned) ?? 0;
  const col = RATE_BANDS.findIndex((b) => pct <= b.upTo);
  return { row, col };
}

export function teamIncentive(delivered: number, returned: number): number {
  const { row, col } = teamCell(delivered, returned);
  return row < 0 || col < 0 ? 0 : TEAM_GRID[row][col];
}
