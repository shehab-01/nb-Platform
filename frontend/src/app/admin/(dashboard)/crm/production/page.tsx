"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CookingPot, Plus, UserCog } from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { ProductionOnly } from "@/components/admin/production/access";
import { AccessDialog } from "@/components/admin/production/access-dialog";
import { dhakaToday, taka, takaPaisa } from "@/components/admin/production/format";
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
    <ProductionOnly>
      {/* useSearchParams needs a Suspense boundary above it. */}
      <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ProductionList />
      </React.Suspense>
    </ProductionOnly>
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

// The table's columns, shared by its head, rows and total so they line up.
const COLS =
  "grid grid-cols-[4.5rem_6rem_minmax(0,1fr)_4rem_5rem_7rem_7rem] gap-3 px-5";

/** "9/10": day/month, as the kitchen writes it. */
function dayMonth(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
}

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}

function ProductionList() {
  const router = useRouter();
  const { can } = useAuth();
  const isAdmin = can("production.admin");
  const [managing, setManaging] = React.useState(false);
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Production</h1>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="lg" className="gap-1.5" onClick={() => setManaging(true)}>
              <UserCog className="size-4" />
              Manage access
            </Button>
          )}
          {/* A button, not a styled <Link>: globals.css colours every <a>
              outside Tailwind's layers, which would hide the label. */}
          <Button
            size="lg"
            className="gap-1.5"
            onClick={() => router.push("/admin/crm/production/new")}
          >
            <Plus className="size-4" />
            Add production
          </Button>
        </div>
      </div>
      {isAdmin && <AccessDialog open={managing} onOpenChange={setManaging} />}

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
      {/* A fixed-height box: the rows scroll between the column heads and
          the month's total, which stays at the bottom however few rows. */}
      <Card className="mt-4 gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <div className="flex h-[calc(100svh-24rem)] min-h-80 min-w-176 flex-col">
            <div className={cn(COLS, "border-b bg-muted/40 py-3 text-xs font-medium text-muted-foreground")}>
              <span>Date</span>
              <span>Name</span>
              <span>Products cooked</span>
              <span className="text-right">Patils</span>
              <span className="text-right">Jars</span>
              <span className="text-right">Total cost</span>
              <span className="text-right">Cost per jar</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {days === null ? (
                <div className="grid gap-2 p-5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : days.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                    <CookingPot className="size-6 text-muted-foreground" />
                  </span>
                  <p className="mt-4 font-medium">{monthName(month)}-এ কোনো প্রোডাকশন নেই।</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    রান্নার দিন শেষে &ldquo;Add production&rdquo; চাপুন।
                  </p>
                </div>
              ) : (
                days.map((d, i) => (
                  <div
                    key={d.day}
                    role="link"
                    tabIndex={0}
                    onClick={() => open(d.day)}
                    onKeyDown={(e) => e.key === "Enter" && open(d.day)}
                    className={cn(
                      COLS,
                      "cursor-pointer items-center border-b py-3 text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                      d.day === saved && "bg-primary/5"
                    )}
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-semibold tabular-nums">{dayMonth(d.day)}</span>
                      <span className="text-xs text-muted-foreground">{weekday(d.day)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {/* Cooks are numbered by date within the month: the
                          month's first cook is Cook 1. */}
                      <span className="font-medium">Cook {days.length - i}</span>
                      {d.day === saved && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          Saved
                        </span>
                      )}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {d.product_names.join(", ") || "—"}
                    </span>
                    <span className="text-right tabular-nums">{d.patils}</span>
                    <span className="text-right tabular-nums">{d.jars.toLocaleString("en-IN")}</span>
                    <span className="text-right tabular-nums">{taka(d.total_cost)}</span>
                    <span className="text-right font-semibold tabular-nums">
                      {takaPaisa(d.cost_per_jar)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className={cn(COLS, "border-t bg-primary/10 py-3.5 text-sm font-semibold")}>
              <span className="col-span-3">
                Total · {monthName(month)} · {days?.length ?? 0} cooks
              </span>
              <span className="text-right tabular-nums">{patils}</span>
              <span className="text-right tabular-nums">{jars.toLocaleString("en-IN")}</span>
              <span className="text-right tabular-nums">{taka(cost)}</span>
              <span className="text-right tabular-nums">{jars ? takaPaisa(cost / jars) : "—"}</span>
            </div>
          </div>
        </div>
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
