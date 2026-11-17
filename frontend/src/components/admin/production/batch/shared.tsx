"use client";

import * as React from "react";
import { useAuth } from "@/components/admin/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SlotCostBasis } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The batch pages are for stores whose production mode is "batch"; the
 *  API refuses the rest too. Switching store starts the page over. */
export function BatchOnly({ children }: { children: React.ReactNode }) {
  const { store, can } = useAuth();
  if (!store || !can("production")) {
    return (
      <p className="text-sm text-muted-foreground">
        Production is open to production admins and the people they choose.
      </p>
    );
  }
  if (store.productionMode !== "batch") {
    return (
      <p className="text-sm text-muted-foreground">
        This store records production by day. A super admin can change that on the store form.
      </p>
    );
  }
  return <React.Fragment key={store.storeId}>{children}</React.Fragment>;
}

/** Whole numbers with Indian grouping: 12,000 or 1,20,000. */
export const count = (n: number) => n.toLocaleString("en-IN");

/** A rate or unit price, with its paisa only when it has some: ৳400, ৳3.15. */
export function rate(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `৳${n.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export const BASIS_LABELS: Record<SlotCostBasis, string> = {
  per_1000_pieces: "Per 1,000 pieces",
  per_packet: "Per packet",
  fixed: "Fixed amount",
};

// The amounts below are worked out again by the server on save; these only
// show them while typing. Same rule: half up to whole taka.

function wholeTaka(x: number): number {
  // Clear floating-point dust first (3 × 3.15 is 9.450000000000001).
  return Math.round(Math.round(x * 1000) / 1000);
}

/** A typed decimal as a number, or null when blank or not a number. */
export function num(text: string): number | null {
  const t = text.trim();
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function lineAmount(quantity: number | null, unitPrice: number | null): number {
  return quantity === null || unitPrice === null ? 0 : wholeTaka(quantity * unitPrice);
}

export function slotLineAmount(
  basis: SlotCostBasis,
  rateValue: number | null,
  amount: number | null,
  packets: number,
  piecesPerPacket: number
): number {
  if (basis === "fixed") return amount ?? 0;
  if (rateValue === null) return 0;
  if (basis === "per_packet") return wholeTaka(rateValue * packets);
  return wholeTaka((rateValue * packets * piecesPerPacket) / 1000);
}

/** Received against ordered, as a bar. */
export function ReceivedBar({ received, units }: { received: number; units: number }) {
  const share = units ? Math.min(received / units, 1) : 0;
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={units}
      aria-valuenow={received}
      aria-label="Packets received"
    >
      <div
        className={cn("h-full rounded-full", share >= 1 ? "bg-emerald-500" : "bg-primary")}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}

export function Figure({
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

export function StatusBadge({ closed, closedEarly }: { closed: boolean; closedEarly: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px] font-medium",
        !closed && "bg-primary/10 text-primary",
        closed && !closedEarly && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        closedEarly && "bg-amber-500/15 text-amber-800 dark:text-amber-300"
      )}
    >
      {!closed ? "Open" : closedEarly ? "Closed early" : "Closed"}
    </span>
  );
}

/** Hands a Blob over as a file download. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
