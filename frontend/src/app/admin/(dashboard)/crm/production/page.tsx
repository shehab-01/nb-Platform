"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CookingPot, Plus } from "lucide-react";
import { CrmOnly } from "@/components/admin/production/access";
import { dayLabel, dhakaToday, taka, takaPaisa } from "@/components/admin/production/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listProductionDays, type ProductionDaySummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Production Cost: every production of a month in a table, newest first,
 * with the month in figures above it. "Add production" opens the entry page;
 * a row opens that production's dashboard. The month is in the URL
 * (?month=YYYY-MM), so saving a production can come back to its month.
 */
export default function ProductionListPage() {
  return (
    <CrmOnly>
      {/* useSearchParams needs a Suspense boundary above it. */}
      <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ProductionList />
      </React.Suspense>
    </CrmOnly>
  );
}

const MONTH = /^\d{4}-\d{2}$/;

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function ProductionList() {
  const router = useRouter();
  const params = useSearchParams();
  const thisMonth = dhakaToday().slice(0, 7);
  const asked = params.get("month") ?? "";
  const month = MONTH.test(asked) && asked <= thisMonth ? asked : thisMonth;
  // The production just saved, to point it out in the list.
  const saved = params.get("saved");

  const [rows, setRows] = React.useState<{ month: string; days: ProductionDaySummary[] } | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listProductionDays({ start: `${month}-01`, end: lastDay(month), limit: 31 })
      .then((days) => {
        if (cancelled) return;
        setRows({ month, days });
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const days = rows?.month === month ? rows.days : null;
  const go = (m: string) => router.replace(`/admin/crm/production?month=${m}`, { scroll: false });
  const open = (day: string) => router.push(`/admin/crm/production/${day}`);

  const jars = days?.reduce((s, d) => s + d.jars, 0) ?? 0;
  const cost = days?.reduce((s, d) => s + d.total_cost, 0) ?? 0;
  const patils = days?.reduce((s, d) => s + d.patils, 0) ?? 0;

  return (
    <div className="@container">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Cost</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            প্রতিদিনের রান্নার খরচ, প্রতি জার পর্যন্ত হিসাব।
          </p>
        </div>
        <Button asChild size="lg" className="gap-1.5">
          <Link href="/admin/crm/production/new">
            <Plus className="size-4" />
            Add production
          </Link>
        </Button>
      </div>

      {/* --- Which month --- */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-40 text-center text-lg font-semibold">{monthName(month)}</div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next month"
          disabled={month >= thisMonth}
          onClick={() => go(shiftMonth(month, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        {month !== thisMonth && (
          <Button variant="ghost" size="sm" onClick={() => go(thisMonth)}>
            This month
          </Button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- The month in figures --- */}
      <div className="mt-4 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <Figure label="Productions" value={days ? String(days.length) : undefined} note={`${patils} পাতিল`} />
        <Figure label="Jars produced" value={days ? jars.toLocaleString("en-IN") : undefined} />
        <Figure label="Total cost" value={days ? taka(cost) : undefined} />
        <Figure
          label="Average cost per jar"
          value={days ? (jars ? takaPaisa(cost / jars) : "—") : undefined}
          emphasis
        />
      </div>

      {/* --- Every production of the month --- */}
      <Card className="mt-4">
        <CardContent className="px-3 sm:px-6">
          {days === null ? (
            <Skeleton className="h-40 w-full" />
          ) : days.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                <CookingPot className="size-6 text-muted-foreground" />
              </span>
              <p className="mt-4 font-medium">{monthName(month)}-এ কোনো প্রোডাকশন নেই।</p>
              <p className="mt-1 text-sm text-muted-foreground">
                রান্নার দিন শেষে &ldquo;Add production&rdquo; চাপুন।
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2.5 font-normal">Date</th>
                    <th className="py-2.5 font-normal">Products cooked</th>
                    <th className="py-2.5 text-right font-normal">Patils</th>
                    <th className="py-2.5 text-right font-normal">Jars</th>
                    <th className="py-2.5 text-right font-normal">Total cost</th>
                    <th className="py-2.5 text-right font-normal">Cost per jar</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr
                      key={d.day}
                      onClick={() => open(d.day)}
                      className={cn(
                        "cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50",
                        d.day === saved && "bg-primary/5"
                      )}
                    >
                      <td className="py-3">
                        <Link
                          href={`/admin/crm/production/${d.day}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium hover:underline"
                        >
                          {dayLabel(d.day, { weekday: true })}
                        </Link>
                        {d.day === saved && (
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            Saved
                          </span>
                        )}
                      </td>
                      <td className="max-w-72 py-3">
                        <span className="line-clamp-2 text-muted-foreground">
                          {d.product_names.join(", ") || "—"}
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums">{d.patils}</td>
                      <td className="py-3 text-right tabular-nums">{d.jars.toLocaleString("en-IN")}</td>
                      <td className="py-3 text-right tabular-nums">{taka(d.total_cost)}</td>
                      <td className="py-3 text-right font-semibold tabular-nums">
                        {takaPaisa(d.cost_per_jar)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-medium">
                    <td colSpan={2} className="rounded-l-md px-2 py-2.5">
                      {monthName(month)} · {days.length} productions
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{patils}</td>
                    <td className="py-2.5 text-right tabular-nums">{jars.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 text-right tabular-nums">{taka(cost)}</td>
                    <td className="rounded-r-md px-2 py-2.5 text-right font-semibold tabular-nums">
                      {jars ? takaPaisa(cost / jars) : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string | undefined;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("gap-1 py-4", emphasis && "border-primary/30 bg-primary/5")}>
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {value === undefined ? <Skeleton className="h-8 w-24" /> : value}
        </div>
        {note && value !== undefined && (
          <div className="mt-1 text-xs text-muted-foreground">{note}</div>
        )}
      </CardContent>
    </Card>
  );
}
