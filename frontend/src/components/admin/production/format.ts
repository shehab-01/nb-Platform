/** Today in Dhaka, as YYYY-MM-DD. */
export function dhakaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}

/** "28 Sep 2026" for a YYYY-MM-DD day. */
export function dayLabel(iso: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: opts.weekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: opts.year === false ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/** "8:00 AM" for "08:00" or "08:00:00". */
export function clock(hm: string | null | undefined): string {
  if (!hm) return "—";
  const [h, m] = hm.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

export const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;

/** Cost per jar keeps its paisa: ৳40.63. */
export const takaPaisa = (n: number) =>
  `৳${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** YYYY-MM-DD for a UTC-midnight Date (calendar arithmetic stays in UTC). */
export function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
