"use client";

import * as React from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FraudCheck, FraudCourier } from "@/lib/orders";
import { cn } from "@/lib/utils";

/** Green / amber / red / grey by delivered share. */
export function rateTone(rate: number | null): "good" | "warn" | "bad" | "none" {
  if (rate === null) return "none";
  if (rate >= 80) return "good";
  if (rate >= 50) return "warn";
  return "bad";
}

const TONE_TEXT = {
  good: "text-[#16a34a]",
  warn: "text-[#ea8a1a]",
  bad: "text-[#dc2626]",
  none: "text-muted-foreground",
} as const;
const TONE_STROKE = {
  good: "#16a34a",
  warn: "#ea8a1a",
  bad: "#dc2626",
  none: "#94a3b8",
} as const;

/** A small ring showing the delivered share. */
function Ring({ rate, size = 40 }: { rate: number | null; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = rate === null ? 0 : Math.max(0, Math.min(100, rate));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={5} className="text-muted-foreground/25" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={TONE_STROKE[rateTone(rate)]}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/**
 * The table cell: ring, delivered share, delivered/total and a flag if any
 * courier has reported this number for fraud. "0" when there is no history
 * at all; "—" while the check has not run.
 */
export function FraudBadge({ fraud }: { fraud: FraudCheck | null }) {
  if (!fraud) return <span className="text-muted-foreground">—</span>;
  if (fraud.error) {
    return (
      <span className="text-xs text-muted-foreground" title={fraud.error}>
        Check failed
      </span>
    );
  }
  if (fraud.total === 0 && fraud.reports.length === 0) {
    return <span className="text-muted-foreground">0</span>;
  }
  const tone = rateTone(fraud.successRate);
  return (
    <div className="flex items-center gap-2.5">
      <Ring rate={fraud.successRate} />
      <div className="text-xs leading-5">
        <div>
          Success:{" "}
          <span className={cn("font-medium", TONE_TEXT[tone])}>
            {fraud.successRate === null ? "—" : `${Math.round(fraud.successRate)}%`}
          </span>
        </div>
        <div>
          Order: <span className={cn("font-medium", TONE_TEXT[tone])}>{fraud.success}/{fraud.total}</span>
        </div>
        {fraud.reports.length > 0 && (
          <div className="flex items-center gap-1 text-[#dc2626]">
            <ShieldAlert className="size-3" />
            <span className="font-medium">
              {fraud.reports.length} fraud report{fraud.reports.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The couriers the cards always show, in this order, whether or not
 * BDCourier returned them (CarryBee has no data yet: it shows dashes). */
const COURIERS: { key: string; title: string }[] = [
  { key: "pathao", title: "Pathao" },
  { key: "steadfast", title: "Steadfast" },
  { key: "redx", title: "RedX" },
  { key: "carrybee", title: "CarryBee" },
];

function courierRate(c: FraudCourier): number | null {
  if (c.successRate !== null) return c.successRate;
  return c.total > 0 ? Math.round((c.success / c.total) * 1000) / 10 : null;
}

/** One compact card: a header with logo and name, three or four figures, a bar. */
function Card({
  title,
  logo,
  rate,
  total,
  success,
  cancel,
  empty,
  onRefresh,
  refreshing,
}: {
  title: string;
  logo?: string | null;
  rate: number | null;
  total: number;
  success: number;
  cancel: number;
  /** No data from BDCourier for this courier. */
  empty?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const tone = empty ? "none" : rateTone(rate);
  const dash = <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card text-xs">
      <div className="flex h-7 items-center gap-1.5 bg-muted px-2 font-medium">
        {logo && <Logo src={logo} alt="" />}
        <span className="truncate">{title}</span>
        {onRefresh && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto size-5"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Check again"
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-2 px-2 pt-1.5 leading-5">
        <dt className="text-muted-foreground">Success Rate</dt>
        <dd className={cn("font-semibold tabular-nums", TONE_TEXT[tone])}>
          {empty || rate === null ? dash : `${Math.round(rate)}%`}
        </dd>
        <dt className="text-muted-foreground">Total</dt>
        <dd className="tabular-nums">{empty ? dash : total}</dd>
        <dt className="text-muted-foreground">Success</dt>
        <dd className="tabular-nums">{empty ? dash : success}</dd>
        <dt className="text-muted-foreground">Cancelled</dt>
        <dd className="tabular-nums">{empty ? dash : cancel}</dd>
      </dl>
      <div className="mx-2 my-2 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${empty ? 0 : (rate ?? 0)}%`, background: TONE_STROKE[tone] }}
        />
      </div>
    </div>
  );
}

/** A courier logo from BDCourier's response; hidden if it fails to load. */
function Logo({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = React.useState(false);
  if (broken) return null;
  // Plain img: the URL is BDCourier's, not ours to optimise.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="size-4 shrink-0 rounded-sm object-contain" onError={() => setBroken(true)} />;
}

/**
 * The strip at the top of an order modal or the manual order form: Overall,
 * then the four couriers, always five cards on one row.
 */
export function FraudCards({
  fraud,
  loading,
  onRefresh,
  refreshing,
}: {
  fraud: FraudCheck | null;
  /** True while the first lookup is in flight. */
  loading?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  if (loading && !fraud) {
    return <p className="text-xs text-muted-foreground">Checking courier history…</p>;
  }
  if (!fraud) return null;
  if (fraud.error) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <span>Courier history unavailable: {fraud.error}</span>
        {onRefresh && (
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onRefresh} disabled={refreshing}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  const byKey = new Map(fraud.couriers.map((c) => [c.name.toLowerCase(), c]));

  return (
    <div className="flex flex-col gap-2">
      {fraud.reports.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/5 px-3 py-2 text-xs text-[#dc2626]">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <span className="font-medium">
              {fraud.reports.length} fraud report{fraud.reports.length === 1 ? "" : "s"} filed against this number
            </span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[#dc2626]/90">
              {fraud.reports.map((r) => (
                <li key={r.id}>
                  {r.courierName ? `${r.courierName}: ` : ""}
                  {r.details || "No details given"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Card
          title="Overall"
          rate={fraud.successRate}
          total={fraud.total}
          success={fraud.success}
          cancel={fraud.cancel}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
        {COURIERS.map(({ key, title }) => {
          const c = byKey.get(key);
          return c ? (
            <Card
              key={key}
              title={title}
              logo={c.logo}
              rate={courierRate(c)}
              total={c.total}
              success={c.success}
              cancel={c.cancel}
            />
          ) : (
            <Card key={key} title={title} rate={null} total={0} success={0} cancel={0} empty />
          );
        })}
      </div>
    </div>
  );
}
