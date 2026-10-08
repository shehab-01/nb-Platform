"use client";

import * as React from "react";
import { useAuth } from "@/components/admin/auth-context";
import { MonthSwitcher } from "@/components/admin/month-switcher";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDeliveryTeam, type DeliveryTeam } from "@/lib/api";
import {
  DELIVERED_TIERS,
  RATE_BANDS,
  TEAM_GRID,
  teamCell,
  teamIncentive,
  teamReturnPct,
} from "@/lib/delivery-team";
import { bdt, dhakaToday, monthLabel } from "@/lib/staff-stats";
import { cn } from "@/lib/utils";

/** "6/10" — day/month, the way the team writes it. */
function shortDay(iso: string): string {
  return `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
}

const n = (x: number) => x.toLocaleString("en-IN");

/**
 * The delivery team's month: the parcels of every order confirmed in it, and
 * the one team incentive they earn. A parcel belongs to the month its order
 * was confirmed — confirmed 31 December, delivered 10 January, is December's
 * — and sits in that month's in-transit figure until Pathao settles it, so
 * a month's incentive keeps moving until its in-transit count reaches 0.
 * Manual orders count. Super admins only — the API refuses everyone else too.
 */
export default function DeliveryTeamPage() {
  const { isSuperAdmin } = useAuth();
  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }
  return <DeliveryTeamView />;
}

function DeliveryTeamView() {
  const today = dhakaToday();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = React.useState(thisMonth);
  const [data, setData] = React.useState<DeliveryTeam | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    getDeliveryTeam(month)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const delivered = data?.delivered ?? 0;
  const returned = data?.returned ?? 0;
  const pct = teamReturnPct(delivered, returned);
  const exact =
    delivered + returned ? (returned / (delivered + returned)) * 100 : null;
  const cell = teamCell(delivered, returned);
  const incentive = teamIncentive(delivered, returned);
  // The next row up, to say how far off it is this month.
  const nextTier = [...DELIVERED_TIERS].reverse().find((from) => delivered < from);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Delivery Team</h1>
          <p lang="bn" className="mt-1 text-sm text-muted-foreground">
            মাসে মোট কতগুলো পার্সেল ডেলিভারি হয়েছে এবং রিটার্ন রেট কত, সেই
            অনুযায়ী পুরো টিমের ইনসেনটিভ। অর্ডার যে মাসে কনফার্ম হয়েছে, পার্সেল
            সেই মাসেই গোনা হয় — যেমন 31 ডিসেম্বর কনফার্ম হয়ে 10 জানুয়ারি
            ডেলিভারি হলে ডিসেম্বরে গোনা হবে। ডেলিভারি বা রিটার্ন না হওয়া পর্যন্ত
            পার্সেলটি সেই মাসের ইন ট্রানজিটে থাকবে। রিটার্ন রেট = রিটার্ন ÷ (ডেলিভারি + রিটার্ন)।
            ম্যানুয়াল অর্ডারও গোনা হয়। 5,000-এর কম ডেলিভারি বা 20%-এর বেশি
            রিটার্ন হলে ইনসেনটিভ নেই।
          </p>
        </div>
        <MonthSwitcher month={month} thisMonth={thisMonth} onMonth={setMonth} />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- The month in six numbers ---------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Confirmed"
          value={data && n(data.sent)}
          hint="Sent to Pathao"
        />
        <Tile label="Delivered" value={data && n(delivered)} tone="green" />
        <Tile label="Returned" value={data && n(returned)} />
        <Tile
          label="In transit"
          value={data && n(data.in_transit)}
          hint="Not delivered or returned yet"
          tone="sky"
        />
        <Tile
          label="Return rate"
          value={data && (pct === null ? "—" : `${pct}%`)}
          hint={
            exact !== null && exact !== pct
              ? `${exact.toFixed(2)}%, rounded up`
              : undefined
          }
        />
        <Tile
          label="Team incentive"
          value={data && bdt(incentive)}
          hint={data && data.in_transit > 0 ? "Not final yet" : undefined}
          tone={incentive > 0 ? "green" : "neutral"}
          emphasis={incentive > 0}
        />
      </div>

      {/* While parcels are still out, the month can still change: say how
          far off the next row is, and why the figure is not final. */}
      {data && data.in_transit > 0 && (
        <p className="-mt-2 text-sm text-muted-foreground">
          {n(data.in_transit)} of {monthLabel(month)}&apos;s parcels are still
          with Pathao. The incentive is final once they are all delivered or
          returned.
          {nextTier !== undefined && (
            <>
              {" "}
              {n(nextTier - delivered)} more delivered reaches the{" "}
              {n(nextTier)}+ row.
            </>
          )}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        {/* --- The grid, with this month's cell marked ----------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Incentive grid</CardTitle>
            <CardDescription>
              Row by parcels delivered, column by return rate (rounded up).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-120 text-sm tabular-nums">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Delivered</th>
                  {RATE_BANDS.map((b) => (
                    <th key={b.upTo} className="py-2 pr-3 text-right font-medium">
                      {b.label}
                    </th>
                  ))}
                  <th className="py-2 text-right font-medium">Over 20%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {DELIVERED_TIERS.map((from, row) => (
                  <tr
                    key={from}
                    className={cn(data && cell.row === row && "bg-muted/50")}
                  >
                    <td className="py-2 pr-3 font-medium">
                      {n(from)}
                      {row === 0 ? "+" : ` – ${n(DELIVERED_TIERS[row - 1] - 1)}`}
                    </td>
                    {TEAM_GRID[row].map((amount, col) => {
                      const hit = data && cell.row === row && cell.col === col;
                      return (
                        <td key={col} className="py-1 pr-1 text-right">
                          <span
                            className={cn(
                              "inline-block rounded-md px-2 py-1",
                              hit &&
                                "bg-emerald-100 font-semibold text-emerald-800 ring-1 ring-emerald-400 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-700"
                            )}
                          >
                            {bdt(amount)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-2 text-right text-muted-foreground">৳0</td>
                  </tr>
                ))}
                <tr className={cn(data && cell.row < 0 && "bg-muted/50")}>
                  <td className="py-2 pr-3 font-medium">
                    0 – {n(DELIVERED_TIERS[DELIVERED_TIERS.length - 1] - 1)}
                  </td>
                  <td
                    colSpan={RATE_BANDS.length + 1}
                    className="py-2 text-right text-muted-foreground"
                  >
                    ৳0
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* --- Day by day ----------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Day by day</CardTitle>
            <CardDescription>
              By the day each order was confirmed, and where its parcel is now.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!data ? (
              <div className="px-6 pb-6">
                <Skeleton className="h-60 w-full" />
              </div>
            ) : data.days.length === 0 ? (
              <p className="px-6 pb-6 text-center text-sm text-muted-foreground">
                No orders confirmed in {monthLabel(month)}.
              </p>
            ) : (
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-y bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-4 py-2 text-right font-medium">Confirmed</th>
                    <th className="px-4 py-2 text-right font-medium">Delivered</th>
                    <th className="px-4 py-2 text-right font-medium">Returned</th>
                    <th className="px-4 py-2 text-right font-medium">In transit</th>
                    <th className="px-4 py-2 text-right font-medium">Return rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.days.map((d) => {
                    const rate = teamReturnPct(d.delivered, d.returned);
                    return (
                      <tr key={d.day}>
                        <td className="px-4 py-2">{shortDay(d.day)}</td>
                        <td className="px-4 py-2 text-right">{n(d.sent)}</td>
                        <td className="px-4 py-2 text-right font-medium text-emerald-700 dark:text-emerald-400">
                          {n(d.delivered)}
                        </td>
                        <td className="px-4 py-2 text-right">{n(d.returned)}</td>
                        <td
                          className={cn(
                            "px-4 py-2 text-right",
                            d.in_transit > 0
                              ? "text-sky-700 dark:text-sky-400"
                              : "text-muted-foreground/60"
                          )}
                        >
                          {n(d.in_transit)}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {rate === null ? "—" : `${rate}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/50 font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right">{n(data.sent)}</td>
                    <td className="px-4 py-2 text-right text-emerald-700 dark:text-emerald-400">
                      {n(delivered)}
                    </td>
                    <td className="px-4 py-2 text-right">{n(returned)}</td>
                    <td className="px-4 py-2 text-right text-sky-700 dark:text-sky-400">
                      {n(data.in_transit)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {pct === null ? "—" : `${pct}%`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: string | null | undefined;
  hint?: string;
  tone?: "neutral" | "green" | "sky";
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5",
        tone === "green" &&
          "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
        tone === "sky" &&
          "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30"
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-semibold tabular-nums",
          emphasis ? "text-3xl text-emerald-700 dark:text-emerald-400" : "text-2xl"
        )}
      >
        {value === null || value === undefined ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          value
        )}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
