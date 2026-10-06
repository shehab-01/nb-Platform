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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getStaffInTransit,
  getStaffStats,
  type StaffDayOrder,
  type StaffDayStats,
  type StaffStats,
} from "@/lib/api";
import {
  bdt,
  dhakaToday,
  incentiveFor,
  INCENTIVE_TIERS,
  monthLabel,
  payableShare,
  RETURN_PENALTY,
  returnRate,
  returnTier,
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
  /** The days' incentive added up, before the return-rate cut. */
  earned: number;
  /** The share of it paid, from the month's return rate. */
  share: number;
  payable: number;
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
        const total = sum(days);
        const earned = days.reduce((n, d) => n + incentiveFor(d.delivered), 0);
        const share = payableShare(total);
        return {
          userId: s.user_id,
          name: staffName(s),
          days,
          total,
          earned,
          share,
          payable: Math.round(earned * share),
        };
      })
      .filter((s) => s.days.length > 0)
      .sort(
        (a, b) =>
          b.payable - a.payable ||
          b.earned - a.earned ||
          b.total.delivered - a.total.delivered
      );
  }, [data]);

  const payout = sheets.reduce((n, s) => n + s.payable, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Incentive</h1>
          {/* The rule in Bangla, for the admins who settle the payouts. */}
          <p lang="bn" className="mt-1 text-sm text-muted-foreground">
            প্রতিদিনের ইনসেনটিভ, ডেলিভারি হওয়া অর্ডার অনুযায়ী:{" "}
            {[...INCENTIVE_TIERS]
              .reverse()
              .map((t) => `${t.delivered}+ → ${bdt(t.bdt)}`)
              .join(" · ")}
            । অর্ডার যেদিন কনফার্ম হয়েছে, ডেলিভারি সেই দিনেই গোনা হয় — তাই
            সাম্প্রতিক দিনগুলোর সংখ্যা পার্সেল পৌঁছানোর সাথে সাথে বাড়তে থাকবে।
          </p>
          <p lang="bn" className="mt-1 text-sm text-muted-foreground">
            এরপর মাসের মোট ইনসেনটিভ রিটার্ন রেট অনুযায়ী কাটা হয় (রিটার্ন ÷
            কনফার্ম):{" "}
            {[...RETURN_PENALTY]
              .reverse()
              .map((t) => `${t.labelBn} → ${Math.round(t.share * 100)}%`)
              .join(" · ")}
            । কীভাবে হিসাব হয়েছে দেখতে টাকার অঙ্কে ক্লিক করুন।
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">
                {monthLabel(month)} payable
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
            <SheetCard key={s.userId} sheet={s} month={month} />
          ))}
        </div>
      )}
    </div>
  );
}

function SheetCard({ sheet, month }: { sheet: Sheet; month: string }) {
  const { total } = sheet;
  const [explain, setExplain] = React.useState(false);
  const [transit, setTransit] = React.useState(false);
  return (
    <Card className="overflow-hidden">
      <BreakdownDialog sheet={sheet} open={explain} onOpenChange={setExplain} />
      <InTransitDialog
        sheet={sheet}
        month={month}
        open={transit}
        onOpenChange={setTransit}
      />
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
        <div className="mr-auto">
          <CardTitle>{sheet.name}</CardTitle>
          <CardDescription className="mt-1">
            {sheet.days.length} {sheet.days.length === 1 ? "day" : "days"} worked
          </CardDescription>
        </div>
        {/* Still with Pathao: some of these may yet come back and push the
            return rate up, so it sits right next to the amount it threatens. */}
        <button
          type="button"
          onClick={() => setTransit(true)}
          disabled={total.in_transit === 0}
          title="Parcels still with Pathao"
          className="-m-1.5 rounded-md p-1.5 text-right transition-colors enabled:hover:bg-accent"
        >
          <div className="text-xs text-muted-foreground">In transit</div>
          <div
            className={cn(
              "text-lg font-semibold tabular-nums",
              total.in_transit > 0
                ? "text-sky-700 underline decoration-dotted underline-offset-4 dark:text-sky-400"
                : "text-muted-foreground/60"
            )}
          >
            {total.in_transit}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setExplain(true)}
          title="How was this worked out?"
          className="-m-1.5 rounded-md p-1.5 text-right transition-colors hover:bg-accent"
        >
          <div className="text-xs text-muted-foreground">Payable</div>
          <div
            className={cn(
              "text-lg font-semibold tabular-nums underline decoration-dotted underline-offset-4",
              sheet.payable > 0 && "text-emerald-700 dark:text-emerald-400"
            )}
          >
            {bdt(sheet.payable)}
          </div>
          {sheet.earned > 0 && sheet.share < 1 && (
            <div className="text-xs text-red-700 tabular-nums dark:text-red-400">
              {Math.round(sheet.share * 100)}% of {bdt(sheet.earned)}
            </div>
          )}
        </button>
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
              <td className="px-3 py-2 text-right">{bdt(sheet.earned)}</td>
            </tr>
            {/* The return-rate cut, applied to the month as a whole. */}
            <tr className="border-t bg-muted/50 tabular-nums">
              <td colSpan={6} className="px-3 py-2 text-right text-xs text-muted-foreground">
                Return rate {returnRate(total)} →{" "}
                {sheet.share === 1
                  ? "paid in full"
                  : `${Math.round(sheet.share * 100)}% paid`}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => setExplain(true)}
                  title="How was this worked out?"
                  className={cn(
                    "font-semibold underline decoration-dotted underline-offset-4 hover:opacity-80",
                    sheet.payable > 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground"
                  )}
                >
                  {bdt(sheet.payable)}
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}

/**
 * How one person's amount was reached, step by step: what each day earned,
 * the month's return rate and the tier it falls in, and the sum that gives
 * the payable figure.
 */
function BreakdownDialog({
  sheet,
  open,
  onOpenChange,
}: {
  sheet: Sheet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { total } = sheet;
  const tier = returnTier(total);
  const earning = sheet.days.filter((d) => incentiveFor(d.delivered) > 0);
  const short = sheet.days.length - earning.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sheet.name}</DialogTitle>
          <DialogDescription>How {bdt(sheet.payable)} was worked out.</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex flex-1 flex-col gap-5 overflow-y-auto px-6 text-sm">
          {/* Step 1 */}
          <section>
            <h3 className="mb-2 font-medium">1. Daily incentive, by orders delivered</h3>
            {earning.length === 0 ? (
              <p className="text-muted-foreground">
                No day reached {INCENTIVE_TIERS.at(-1)?.delivered} delivered, so
                nothing was earned.
              </p>
            ) : (
              <table className="w-full tabular-nums">
                <tbody className="divide-y">
                  {earning.map((d) => (
                    <tr key={d.day}>
                      <td className="py-1.5 pr-3">{shortDay(d.day)}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {d.delivered} delivered
                      </td>
                      <td className="py-1.5 text-right">{bdt(incentiveFor(d.delivered))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {short > 0 && earning.length > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {short} other {short === 1 ? "day" : "days"} under{" "}
                {INCENTIVE_TIERS.at(-1)?.delivered} delivered → ৳0.
              </p>
            )}
            <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
              <span>Earned</span>
              <span className="tabular-nums">{bdt(sheet.earned)}</span>
            </div>
          </section>

          {/* Step 2 */}
          <section>
            <h3 className="mb-2 font-medium">2. The month&apos;s return rate</h3>
            <p className="tabular-nums">
              {total.returned} returned ÷ {total.confirmed} confirmed
              {total.confirmed > 0 && (
                <>
                  {" "}
                  = {((total.returned / total.confirmed) * 100).toFixed(2)}%
                  {", rounded up to "}
                </>
              )}
              {total.confirmed === 0 && " = "}
              <b>{returnRate(total)}</b>
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {[...RETURN_PENALTY].reverse().map((t) => (
                <li
                  key={t.label}
                  className={cn(
                    "flex justify-between rounded-md px-2.5 py-1.5",
                    t === tier
                      ? "bg-primary/10 font-semibold ring-1 ring-primary/40"
                      : "text-muted-foreground"
                  )}
                >
                  <span>{t.label}</span>
                  <span>{Math.round(t.share * 100)}% paid</span>
                </li>
              ))}
            </ul>
            {total.in_transit > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {total.in_transit} {total.in_transit === 1 ? "parcel is" : "parcels are"}{" "}
                still with Pathao. If any come back, the return rate goes up.
              </p>
            )}
          </section>

          {/* Step 3 */}
          <section className="rounded-lg border bg-muted/40 p-3">
            <div className="flex justify-between tabular-nums">
              <span>
                {bdt(sheet.earned)} × {Math.round(tier.share * 100)}%
              </span>
              <span
                className={cn(
                  "text-base font-semibold",
                  sheet.payable > 0 && "text-emerald-700 dark:text-emerald-400"
                )}
              >
                {bdt(sheet.payable)}
              </span>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The parcels behind a person's in-transit figure, loaded when opened. */
function InTransitDialog({
  sheet,
  month,
  open,
  onOpenChange,
}: {
  sheet: Sheet;
  month: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = React.useState<StaffDayOrder[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    getStaffInTransit(sheet.userId, month)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [open, sheet.userId, month]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sheet.name} — in transit</DialogTitle>
          <DialogDescription>
            Orders they confirmed in {monthLabel(month)} that are still with
            Pathao: not delivered, not returned.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex-1 overflow-y-auto px-6">
          {error ? (
            <p className="py-6 text-sm text-destructive">{error}</p>
          ) : rows === null ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing in transit.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Confirmed</th>
                  <th className="py-2 pr-3 font-medium">Order</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Consignment</th>
                  <th className="py-2 text-right font-medium">Pathao status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((o) => (
                  <tr key={o.order_id}>
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted-foreground tabular-nums">
                      {new Date(o.confirmed_at).toLocaleDateString("en-GB", {
                        timeZone: "Asia/Dhaka",
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{o.order_no}</td>
                    <td className="max-w-40 truncate py-2 pr-3">{o.customer_name}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                      {o.consignment_id ?? "—"}
                    </td>
                    <td className="py-2 text-right text-xs text-sky-700 dark:text-sky-400">
                      {o.pathao_status?.replace(/_/g, " ") || "Booked, no update yet"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
