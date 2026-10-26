"use client";

import * as React from "react";
import { ChevronDown, Loader2, RefreshCw, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getCourierFullSync,
  listCouriers,
  startCourierFullSync,
  stopCourierFullSync,
  type CourierOption,
  type CourierSyncRun,
} from "@/lib/api";
import { COURIER_LABELS, formatOrderDateTime, type CourierName } from "@/lib/orders";
import { cn } from "@/lib/utils";

/** Progress poll while a sync runs; the run itself makes ~1 call / 1.5s. */
const POLL_MS = 3_000;

const ENDED_LABEL: Record<string, string> = {
  done: "Last sync finished",
  stopped: "Last sync stopped",
  failed: "Last sync failed",
  interrupted: "Last sync was interrupted (server restarted)",
};

function isActive(run: CourierSyncRun | null | undefined): boolean {
  return run?.status === "running" || run?.status === "stopping";
}

type Runs = Partial<Record<CourierName, CourierSyncRun | null>>;

/**
 * Bring every parcel of one courier not yet delivered or returned up to date,
 * oldest booking first. Staff pick the courier from the button's menu. The
 * work runs on the server, so leaving the page does not stop it; coming back
 * picks the progress up again. Each courier has its own run, so a Pathao
 * and a Carrybee sync may go side by side.
 */
export function CourierFullSync() {
  // The couriers switched on in Settings; only they are offered. null while
  // unknown.
  const [couriers, setCouriers] = React.useState<CourierOption[] | null>(null);
  const [runs, setRuns] = React.useState<Runs>({});
  const [busy, setBusy] = React.useState<CourierName | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [failuresOf, setFailuresOf] = React.useState<CourierName | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listCouriers()
      .then((list) => {
        if (!cancelled) setCouriers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const names = React.useMemo(() => couriers?.map((c) => c.name) ?? [], [couriers]);

  const load = React.useCallback(() => {
    for (const name of names) {
      getCourierFullSync(name)
        .then((run) => setRuns((prev) => ({ ...prev, [name]: run })))
        .catch(() => {});
    }
  }, [names]);

  React.useEffect(load, [load]);

  const anyActive = names.some((name) => isActive(runs[name]));
  React.useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [anyActive, load]);

  const start = async (name: CourierName) => {
    setBusy(name);
    setError(null);
    try {
      const run = await startCourierFullSync(name);
      setRuns((prev) => ({ ...prev, [name]: run }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the sync");
    } finally {
      setBusy(null);
    }
  };

  const stop = async (name: CourierName) => {
    setBusy(name);
    try {
      const next = await stopCourierFullSync(name);
      if (next) setRuns((prev) => ({ ...prev, [name]: next }));
    } finally {
      setBusy(null);
    }
  };

  if (!couriers || couriers.length === 0) return null;

  // A courier already syncing is stopped from its own row, not started again.
  const startable = couriers.filter((c) => !isActive(runs[c.name]));
  const shown = names.filter((name) => runs[name]);
  const failuresRun = failuresOf ? runs[failuresOf] : null;
  const failuresLabel = failuresOf ? COURIER_LABELS[failuresOf] : "";

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium">Sync delivery status with the courier</span>
          <span className="text-sm text-muted-foreground">
            Checks every parcel not yet delivered or returned, oldest first, one
            at a time.
          </span>
        </div>
        {startable.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={busy !== null}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Sync all
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {startable.map((c) => (
                <DropdownMenuItem key={c.name} onSelect={() => start(c.name)}>
                  {c.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {shown.map((name) => (
        <RunProgress
          key={name}
          label={COURIER_LABELS[name]}
          run={runs[name]!}
          busy={busy === name}
          onStop={() => stop(name)}
          onShowFailures={() => setFailuresOf(name)}
          separated={shown.length > 1}
        />
      ))}

      <Dialog open={failuresOf !== null} onOpenChange={(open) => !open && setFailuresOf(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Parcels {failuresLabel} could not answer for</DialogTitle>
            <DialogDescription>
              These keep their old status. They are asked again on the next sync.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-[60svh] flex-col gap-1.5 overflow-y-auto text-sm">
            {failuresRun?.failures.map((item) => (
              <li
                key={item.orderId}
                className="rounded-md bg-red-50 px-3 py-2 text-red-900 dark:bg-red-950/40 dark:text-red-200"
              >
                <span className="flex items-center gap-2 font-medium">
                  <X className="size-4" />
                  {item.orderNo}
                  <span className="font-mono text-xs font-normal">
                    {item.consignmentId}
                  </span>
                </span>
                <span className="mt-1 block text-xs">{item.error}</span>
              </li>
            ))}
          </ul>
          {failuresRun && failuresRun.failed > failuresRun.failures.length && (
            <p className="text-xs text-muted-foreground">
              Showing the first {failuresRun.failures.length} of {failuresRun.failed}.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RunProgress({
  label,
  run,
  busy,
  onStop,
  onShowFailures,
  separated,
}: {
  label: string;
  run: CourierSyncRun;
  busy: boolean;
  onStop: () => void;
  onShowFailures: () => void;
  separated: boolean;
}) {
  const active = isActive(run);
  const percent = run.total > 0 ? Math.round((run.checked / run.total) * 100) : 0;

  return (
    <div className={cn("flex flex-col gap-2", separated && "border-t pt-3")}>
      {active ? (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium tabular-nums">
              {label}:{" "}
              {run.total === 0 && run.checked === 0
                ? "Preparing…"
                : `${run.checked.toLocaleString()} of ${run.total.toLocaleString()} checked`}
            </span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums text-muted-foreground">{percent}%</span>
              <Button
                variant="outline"
                size="sm"
                onClick={onStop}
                disabled={busy || run.status === "stopping"}
              >
                <Square className="size-4" />
                {run.status === "stopping" ? "Stopping…" : "Stop"}
              </Button>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{label}</span>
          {" · "}
          {ENDED_LABEL[run.status] ?? "Last sync"}
          {run.finishedAt ? ` · ${formatOrderDateTime(run.finishedAt)}` : ""}
          {" · "}
          {run.checked.toLocaleString()} of {run.total.toLocaleString()} checked
        </span>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <Stat label="Status changed" value={run.changed} />
        <Stat label="Newly delivered" value={run.delivered} tone="good" />
        <Stat
          label={`${label} could not answer`}
          value={run.failed}
          tone={run.failed > 0 ? "bad" : undefined}
          onClick={run.failed > 0 ? onShowFailures : undefined}
        />
      </div>

      {run.error && <p className="text-sm text-red-600 dark:text-red-400">{run.error}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad";
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-md bg-muted px-2 py-1",
        tone === "good" &&
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        tone === "bad" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
        onClick && "underline-offset-2 hover:underline"
      )}
    >
      {label}: <span className="font-medium tabular-nums">{value.toLocaleString()}</span>
    </Tag>
  );
}
