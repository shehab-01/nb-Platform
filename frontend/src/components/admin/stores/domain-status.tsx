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

export function DomainStatusPill({
  health,
  loading,
  error,
}: {
  /** The probe for the domain this row shows, or undefined before it lands. */
  health: DomainHealth | undefined;
  loading: boolean;
  error?: string;
}) {
  if (loading) {
    return (
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
          <span className={cn(PILL, "border-transparent bg-muted text-muted-foreground")}>
            Check failed
          </span>
        </TooltipTrigger>
        <TooltipContent>{error}</TooltipContent>
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
        <span className={cn(PILL, look.className)}>
          <span
            className={cn(
              "size-1.5 rounded-full",
              health.status === "ok"
                ? "bg-emerald-500"
                : health.status === "not_published" || health.status === "wrong_store"
                  ? "bg-amber-500"
                  : "bg-destructive"
            )}
          />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <p className="font-medium">{health.host}</p>
        <p className="text-pretty">{health.detail}</p>
      </TooltipContent>
    </Tooltip>
  );
}
