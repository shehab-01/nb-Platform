"use client";

import { Loader2 } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DomainHealth, DomainStatus } from "@/lib/api";

/**
 * What a live probe of a store's primary domain found — a different question
 * from the store's own Active/Inactive row, which sits beside it. A store can
 * be Active here while its DNS still points at the old host, and a perfectly
 * published domain can belong to a draft store; the list shows both facts so
 * neither is mistaken for the other.
 */
const LOOK: Record<DomainStatus, { label: string; className: string }> = {
  ok: {
    label: "Live",
    className: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  not_published: {
    label: "Not published",
    className: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-500",
  },
  wrong_store: {
    label: "Wrong store",
    className: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-500",
  },
  unreachable: {
    label: "Unreachable",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  tls_error: {
    label: "TLS error",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  http_error: {
    label: "HTTP error",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

const PILL =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

/** A status as one small dot: green when live, amber when not yet
 *  published, red when broken, grey while unknown. Sized to sit before a
 *  line of text; the caller wraps it in a tooltip. */
function StatusDot({ tone }: { tone: "ok" | "warn" | "bad" | "unknown" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "ok" && "bg-emerald-500 ring-3 ring-emerald-500/20",
        tone === "warn" && "bg-amber-500 ring-3 ring-amber-500/20",
        tone === "bad" && "bg-destructive ring-3 ring-destructive/20",
        tone === "unknown" && "bg-muted-foreground/50",
      )}
    />
  );
}

function tone(status: DomainStatus): "ok" | "warn" | "bad" {
  if (status === "ok") return "ok";
  if (status === "not_published" || status === "wrong_store") return "warn";
  return "bad";
}

export function DomainStatusPill({
  health,
  loading,
  error,
  /** Just the coloured dot, no pill, for the top bar where the address
   *  beside it is the label and the words would only crowd it. The tooltip
   *  still spells the verdict out. */
  dotOnly = false,
}: {
  /** The probe for the domain this row shows, or undefined before it lands. */
  health: DomainHealth | undefined;
  loading: boolean;
  error?: string;
  dotOnly?: boolean;
}) {
  if (loading) {
    return dotOnly ? (
      <Loader2 className="size-3 animate-spin text-muted-foreground" />
    ) : (
      <span className={cn(PILL, "border-transparent bg-muted text-muted-foreground")}>
        <Loader2 className="size-3 animate-spin" />
        Checking…
      </span>
    );
  }
  if (error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {dotOnly ? (
            <span className="inline-flex">
              <StatusDot tone="unknown" />
            </span>
          ) : (
            <span className={cn(PILL, "border-transparent bg-muted text-muted-foreground")}>
              Check failed
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          <p className="font-medium">Check failed</p>
          <p className="text-pretty">{error}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  if (!health) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const look = LOOK[health.status] ?? LOOK.unreachable;
  // The code is the useful part of an HTTP failure, so it goes in the pill
  // rather than only in the tooltip.
  const label =
    health.status === "http_error" && health.httpStatus
      ? `HTTP ${health.httpStatus}`
      : look.label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {dotOnly ? (
          <span className="inline-flex">
            <StatusDot tone={tone(health.status)} />
          </span>
        ) : (
          <span className={cn(PILL, look.className)}>
            <span
              className={cn(
                "size-1.5 rounded-full",
                tone(health.status) === "ok"
                  ? "bg-emerald-500"
                  : tone(health.status) === "warn"
                    ? "bg-amber-500"
                    : "bg-destructive"
              )}
            />
            {label}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {/* The dot alone says nothing without this, so the verdict leads. */}
        <p className="font-medium">
          {label} · {health.host}
        </p>
        <p className="text-pretty">{health.detail}</p>
      </TooltipContent>
    </Tooltip>
  );
}
