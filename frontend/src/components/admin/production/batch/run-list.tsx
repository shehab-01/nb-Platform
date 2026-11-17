"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, PackageOpen, Plus, UserCog } from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { AccessDialog } from "@/components/admin/crm/access-dialog";
import { dayLabel, dhakaToday, taka, takaPaisa } from "@/components/admin/production/format";
import {
  count,
  Figure,
  ReceivedBar,
  StatusBadge,
} from "@/components/admin/production/batch/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listProductionRuns, type ProductionRunSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Batch production: every production still open, whenever it was opened,
 * as cards on top (received against ordered), then the productions opened
 * in a month as a table with that month in figures. The month is in the URL
 * (?month=YYYY-MM), as on the cooking pages.
 */
export default function RunList() {
  return (
    // useSearchParams needs a Suspense boundary above it.
    <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Runs />
    </React.Suspense>
  );
}

const MONTH = /^\d{4}-\d{2}$/;

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
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

const COLS = "grid grid-cols-[6rem_minmax(0,1fr)_6rem_6rem_6rem_7rem_6.5rem] gap-3 px-5";

function Runs() {
  const router = useRouter();
  const { can } = useAuth();
  const crmAdmin = can("crm.admin");
  const [managing, setManaging] = React.useState(false);
  const params = useSearchParams();
  const thisMonth = dhakaToday().slice(0, 7);
  const asked = params.get("month") ?? "";
  const month = MONTH.test(asked) && asked <= thisMonth ? asked : thisMonth;

  const [open, setOpen] = React.useState<ProductionRunSummary[] | null>(null);
  const [rows, setRows] = React.useState<{ month: string; runs: ProductionRunSummary[] } | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listProductionRuns({ open: true })
      .then((r) => !cancelled && setOpen(r))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    listProductionRuns({ start: `${month}-01`, end: lastDay(month) })
      .then((runs) => {
        if (cancelled) return;
        setRows({ month, runs });
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const runs = rows?.month === month ? rows.runs : null;
  const go = (m: string) => router.replace(`/admin/crm/production?month=${m}`, { scroll: false });
  const show = (id: number) => router.push(`/admin/crm/production/runs/${id}`);

  const ordered = runs?.reduce((s, r) => s + r.units, 0) ?? 0;
  const received = runs?.reduce((s, r) => s + r.received, 0) ?? 0;
  const cost = runs?.reduce((s, r) => s + r.totalCost, 0) ?? 0;

  return (
    <div className="@container">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Production</h1>
        <div className="flex flex-wrap items-center gap-2">
          {crmAdmin && (
            <Button variant="outline" size="lg" className="gap-1.5" onClick={() => setManaging(true)}>
              <UserCog className="size-4" />
              Manage access
            </Button>
          )}
          <Button
            size="lg"
            className="gap-1.5"
            onClick={() => router.push("/admin/crm/production/runs/new")}
          >
            <Plus className="size-4" />
            Open production
          </Button>
        </div>
      </div>
      {crmAdmin && <AccessDialog page="production" open={managing} onOpenChange={setManaging} />}

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- Still open, from any month --- */}
      {open === null ? (
        <Skeleton className="mt-6 h-32 w-full" />
      ) : open.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-muted-foreground">Open now</h2>
          <div className="mt-2 grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
            {open.map((r) => (
              <Card
                key={r.id}
                role="link"
                tabIndex={0}
                onClick={() => show(r.id)}
                onKeyDown={(e) => e.key === "Enter" && show(r.id)}
                className="cursor-pointer gap-0 py-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
              >
                <CardContent className="px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Opened {dayLabel(r.openedOn)} · {r.slots} {r.slots === 1 ? "slot" : "slots"}
                      </div>
                    </div>
                    <StatusBadge closed={false} closedEarly={false} />
                  </div>
                  <div className="mt-4 flex items-baseline justify-between text-sm">
                    <span>
                      <span className="text-lg font-semibold tabular-nums">{count(r.received)}</span>
                      <span className="text-muted-foreground"> / {count(r.units)} received</span>
                    </span>
                    <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
                      {count(r.pending)} pending
                    </span>
                  </div>
                  <div className="mt-2">
                    <ReceivedBar received={r.received} units={r.units} />
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                    <span>Cost so far {taka(r.totalCost)}</span>
                    {r.costPerPacket !== null && <span>{takaPaisa(r.costPerPacket)} / packet</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* --- Which month --- */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
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

      <div className="mt-4 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <Figure label="Productions opened" value={runs ? String(runs.length) : undefined} />
        <Figure label="Packets ordered" value={runs ? count(ordered) : undefined} />
        <Figure
          label="Packets received"
          value={runs ? count(received) : undefined}
          note={`${count(Math.max(ordered - received, 0))} pending`}
        />
        <Figure label="Total cost" value={runs ? taka(cost) : undefined} emphasis />
      </div>

      <Card className="mt-4 gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <div className="min-w-176">
            <div className={cn(COLS, "border-b bg-muted/40 py-3 text-xs font-medium text-muted-foreground")}>
              <span>Opened</span>
              <span>Production</span>
              <span className="text-right">Ordered</span>
              <span className="text-right">Received</span>
              <span className="text-right">Pending</span>
              <span className="text-right">Total cost</span>
              <span className="text-right">Per packet</span>
            </div>
            {runs === null ? (
              <div className="grid gap-2 p-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <PackageOpen className="size-6 text-muted-foreground" />
                </span>
                <p className="mt-4 font-medium">No production opened in {monthName(month)}.</p>
              </div>
            ) : (
              runs.map((r) => (
                <div
                  key={r.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => show(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && show(r.id)}
                  className={cn(
                    COLS,
                    "cursor-pointer items-center border-b py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  )}
                >
                  <span className="tabular-nums">{dayLabel(r.openedOn, { year: false })}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <StatusBadge closed={r.closed} closedEarly={r.closedEarly} />
                  </span>
                  <span className="text-right tabular-nums">{count(r.units)}</span>
                  <span className="text-right tabular-nums">{count(r.received)}</span>
                  <span className="text-right tabular-nums">{count(r.pending)}</span>
                  <span className="text-right tabular-nums">{taka(r.totalCost)}</span>
                  <span className="text-right font-semibold tabular-nums">
                    {r.costPerPacket === null ? "—" : takaPaisa(r.costPerPacket)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
