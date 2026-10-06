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
import { getStaffStats, type StaffDayStats, type StaffStats } from "@/lib/api";
import {
  bdt,
  dhakaToday,
  incentiveFor,
  INCENTIVE_TIERS,
  monthLabel,
  returnRate,
  staffName,
  sum,
  type Figures,
} from "@/lib/staff-stats";
import { cn } from "@/lib/utils";

/** "6/10" — day/month, the way the team writes it. */
function shortDay(iso: string): string {
  return `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
}

type Sheet = {
  userId: number;
  name: string;
  days: StaffDayStats[];
  total: Figures;
  incentive: number;
};

/**
 * Each person's month as a ledger: one row per day they worked, and the
 * day's incentive from what it delivered. Built from the same figures as
 * Staff Stats, so delivered lands on the day the order was confirmed and a
 * recent day's incentive keeps rising as its parcels arrive. Manual orders
 * are not counted. Super admins only — the API refuses everyone else too.
 */
export default function IncentivePage() {
  const { isSuperAdmin } = useAuth();
  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }
  return <IncentiveView />;
}

function IncentiveView() {
  const today = dhakaToday();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = React.useState(thisMonth);
  const [data, setData] = React.useState<StaffStats | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    getStaffStats(month)
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

  // Everyone with something to show this month, biggest incentive first.
  const sheets = React.useMemo<Sheet[]>(() => {
    if (!data) return [];
    return data.staff
      .map((s) => {
        const days = data.days.filter(
          (r) =>
            r.user_id === s.user_id &&
            (r.confirmed || r.cancelled || r.delivered || r.returned)
        );
        return {
          userId: s.user_id,
          name: staffName(s),
          days,
          total: sum(days),
          incentive: days.reduce((n, d) => n + incentiveFor(d.delivered), 0),
        };
      })
      .filter((s) => s.days.length > 0)
      .sort(
        (a, b) =>
          b.incentive - a.incentive || b.total.delivered - a.total.delivered
      );
  }, [data]);

  const payout = sheets.reduce((n, s) => n + s.incentive, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Incentive</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per day, by orders delivered:{" "}
            {[...INCENTIVE_TIERS]
              .reverse()
              .map((t) => `${t.delivered}+ → ${bdt(t.bdt)}`)
              .join(" · ")}
            . Delivered counts on the day the order was confirmed, so recent
            days keep rising as parcels arrive.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">
                {monthLabel(month)} total
              </div>
              <div className="text-xl font-semibold tabular-nums">
                {bdt(payout)}
              </div>
            </div>
          )}
          <MonthSwitcher month={month} thisMonth={thisMonth} onMonth={setMonth} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : sheets.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nobody confirmed or cancelled anything in {monthLabel(month)}.
        </p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {sheets.map((s) => (
            <SheetCard key={s.userId} sheet={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SheetCard({ sheet }: { sheet: Sheet }) {
  const { total } = sheet;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
        <div>
          <CardTitle>{sheet.name}</CardTitle>
          <CardDescription className="mt-1">
            {sheet.days.length} {sheet.days.length === 1 ? "day" : "days"} worked
          </CardDescription>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Incentive</div>
          <div
            className={cn(
              "text-lg font-semibold tabular-nums",
              sheet.incentive > 0 && "text-emerald-700 dark:text-emerald-400"
            )}
          >
            {bdt(sheet.incentive)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-120 text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-right font-medium">Confirmed</th>
              <th className="px-3 py-2 text-right font-medium">Cancelled</th>
              <th className="px-3 py-2 text-right font-medium">Delivered</th>
              <th className="px-3 py-2 text-right font-medium">Return</th>
              <th className="px-3 py-2 text-right font-medium">Return rate</th>
              <th className="px-3 py-2 text-right font-medium">Incentive</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sheet.days.map((d) => {
              const pay = incentiveFor(d.delivered);
              return (
                <tr key={d.day} className="tabular-nums">
                  <td className="px-3 py-2">{shortDay(d.day)}</td>
                  <td className="px-3 py-2 text-right">{d.confirmed}</td>
                  <td className="px-3 py-2 text-right">{d.cancelled}</td>
                  <td className="px-3 py-2 text-right font-medium text-emerald-700 dark:text-emerald-400">
                    {d.delivered}
                  </td>
                  <td className="px-3 py-2 text-right">{d.returned}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {returnRate(d)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right",
                      pay > 0
                        ? "font-semibold text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground/60"
                    )}
                  >
                    {pay ? bdt(pay) : "0"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/50 font-semibold tabular-nums">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">{total.confirmed}</td>
              <td className="px-3 py-2 text-right">{total.cancelled}</td>
              <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">
                {total.delivered}
              </td>
              <td className="px-3 py-2 text-right">{total.returned}</td>
              <td className="px-3 py-2 text-right">{returnRate(total)}</td>
              <td className="px-3 py-2 text-right">{bdt(sheet.incentive)}</td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}
