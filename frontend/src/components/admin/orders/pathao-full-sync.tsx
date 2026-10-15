"use client";

import * as React from "react";
import { Loader2, RefreshCw, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getPathaoFullSync,
  startPathaoFullSync,
  stopPathaoFullSync,
  type PathaoSyncRun,
} from "@/lib/api";
import { formatOrderDateTime } from "@/lib/orders";
import { cn } from "@/lib/utils";

/** Progress poll while a sync runs; the run itself makes ~1 call / 1.5s. */
const POLL_MS = 3_000;

const ENDED_LABEL: Record<string, string> = {
  done: "Last sync finished",
  stopped: "Last sync stopped",
  failed: "Last sync failed",
  interrupted: "Last sync was interrupted (server restarted)",
};

function isActive(run: PathaoSyncRun | null): boolean {
  return run?.status === "running" || run?.status === "stopping";
}

/**
 * Bring every parcel not yet delivered or returned up to date with Pathao,
 * oldest booking first. The work runs on the server, so leaving the page
 * does not stop it; coming back picks the progress up again.
 */
export function PathaoFullSync() {
  const [run, setRun] = React.useState<PathaoSyncRun | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showFailures, setShowFailures] = React.useState(false);

  const load = React.useCallback(() => {
    getPathaoFullSync()
      .then(setRun)
      .catch(() => {});
  }, []);

  React.useEffect(load, [load]);

  const active = isActive(run);
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setRun(await startPathaoFullSync());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the sync");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const next = await stopPathaoFullSync();
      if (next) setRun(next);
    } finally {
      setBusy(false);
    }
  };

  const percent =
    run && run.total > 0 ? Math.round((run.checked / run.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium">Sync delivery status with Pathao</span>
          <span className="text-sm text-muted-foreground">
            Checks every parcel not yet delivered or returned, oldest first, one
            at a time.
          </span>
        </div>
        {active ? (
          <Button
            variant="outline"
            size="sm"
            onClick={stop}
            disabled={busy || run?.status === "stopping"}
          >
            <Square className="size-4" />
            {run?.status === "stopping" ? "Stopping…" : "Stop"}
          </Button>
        ) : (
          <Button size="sm" onClick={start} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Sync all
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {run && (
        <div className="flex flex-col gap-2">
          {active ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium tabular-nums">
                  {run.total === 0 && run.checked === 0
                    ? "Preparing…"
                    : `${run.checked.toLocaleString()} of ${run.total.toLocaleString()} checked`}
                </span>
                <span className="tabular-nums text-muted-foreground">{percent}%</span>
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
              label="Pathao could not answer"
              value={run.failed}
              tone={run.failed > 0 ? "bad" : undefined}
              onClick={run.failed > 0 ? () => setShowFailures(true) : undefined}
            />
          </div>

          {run.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{run.error}</p>
          )}
        </div>
      )}

      <Dialog open={showFailures} onOpenChange={setShowFailures}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Parcels Pathao could not answer for</DialogTitle>
            <DialogDescription>
              These keep their old status. They are asked again on the next sync.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-[60svh] flex-col gap-1.5 overflow-y-auto text-sm">
            {run?.failures.map((item) => (
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
          {run && run.failed > run.failures.length && (
            <p className="text-xs text-muted-foreground">
              Showing the first {run.failures.length} of {run.failed}.
            </p>
          )}
        </DialogContent>
      </Dialog>
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
