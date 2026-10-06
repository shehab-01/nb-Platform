"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getStaffDayOrders,
  getStaffStats,
  type StaffDayOrder,
  type StaffDayStats,
  type StaffMember,
  type StaffStats,
} from "@/lib/api";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/orders";
import { cn } from "@/lib/utils";

// --- Months, the shop's way --------------------------------------------------
// YYYY-MM and YYYY-MM-DD strings that mean Dhaka calendar days; arithmetic is
// done in UTC so a viewer's own timezone never moves a day boundary.

function dhakaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}

function shiftMonth(month: string, n: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** The month's days laid out in weeks starting Saturday, the shop's week;
 *  null pads the first and last week. */
function calendarWeeks(month: string): (string | null)[][] {
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 1) % 7; // Saturday → 0
  const cells: (string | null)[] = Array(lead).fill(null);
  for (const d = new Date(first); d.getUTCMonth() === first.getUTCMonth(); ) {
    cells.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const WEEKDAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

// --- Figures -----------------------------------------------------------------

type Figures = Omit<StaffDayStats, "user_id" | "day">;

const ZERO: Figures = {
  handled: 0,
  no_response: 0,
  cancelled: 0,
  confirmed: 0,
  from_incomplete: 0,
  delivered: 0,
  returned: 0,
};

function sum(rows: Figures[]): Figures {
  const out = { ...ZERO };
  for (const r of rows) {
    for (const k of Object.keys(out) as (keyof Figures)[]) out[k] += r[k];
  }
  return out;
}

/** Delivered out of the parcels that have finished their trip; parcels
 *  still on the road don't count against anyone yet. */
function deliveryRate(f: Figures): string {
  const settled = f.delivered + f.returned;
  return settled ? `${Math.round((f.delivered / settled) * 100)}%` : "—";
}

function staffName(s: StaffMember | undefined): string {
  return s ? s.nickname || s.name : "Unknown";
}

const ALL = "all";

/**
 * Each person's work, a month at a time. "All staff" shows everyone side by
 * side and the team's days; picking a person shows their days, and a day
 * opens the orders behind it.
 *
 * Delivered is credited to the day the order was confirmed, not the day the
 * parcel arrived, so a day's delivered figure keeps growing for a few days
 * as Pathao reports in. Manual orders are not counted at all.
 */
export default function StaffStatsPage() {
  const today = dhakaToday();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = React.useState(thisMonth);
  const [who, setWho] = React.useState<string>(ALL);
  const [data, setData] = React.useState<StaffStats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openDay, setOpenDay] = React.useState<string | null>(null);

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

  const userId = who === ALL ? null : Number(who);
  const staffById = React.useMemo(
    () => new Map((data?.staff ?? []).map((s) => [s.user_id, s])),
    [data]
  );
  const rows = React.useMemo(
    () =>
      (data?.days ?? []).filter((r) => userId === null || r.user_id === userId),
    [data, userId]
  );
  const byDay = React.useMemo(() => {
    const m = new Map<string, Figures>();
    for (const r of rows) m.set(r.day, sum([m.get(r.day) ?? ZERO, r]));
    return m;
  }, [rows]);
  const total = React.useMemo(() => sum(rows), [rows]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff Stats</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Delivered counts on the day the order was confirmed, and fills in
            as Pathao reports. Manual orders are not counted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">
              {monthLabel(month)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              disabled={month >= thisMonth}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All staff</SelectItem>
              {data?.staff.map((s) => (
                <SelectItem key={s.user_id} value={String(s.user_id)}>
                  {staffName(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- The month's totals --------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Tile label="Handled" value={data && total.handled} hint="Status changes" />
        <Tile label="Confirmed" value={data && total.confirmed} />
        <Tile
          label="From Incomplete"
          value={data && total.from_incomplete}
          tone="amber"
        />
        <Tile label="No response" value={data && total.no_response} />
        <Tile label="Cancelled" value={data && total.cancelled} />
        <Tile label="Delivered" value={data && total.delivered} tone="green" />
        <Tile label="Returned" value={data && total.returned} />
        <Tile
          label="Delivery rate"
          value={data && deliveryRate(total)}
          hint="Of parcels settled"
        />
      </div>

      {/* --- Everyone side by side ------------------------------------ */}
      {userId === null && (
        <Card>
          <CardHeader>
            <CardTitle>Everyone</CardTitle>
            <CardDescription>
              {monthLabel(month)}. Click a name for their calendar.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <StaffTable
                data={data}
                onPick={(id) => setWho(String(id))}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* --- The calendar --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>
            {userId === null ? "The team, day by day" : staffName(staffById.get(userId))}
          </CardTitle>
          <CardDescription>
            Click a day for{" "}
            {userId === null ? "who did what" : "the orders they confirmed"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <Calendar
              month={month}
              today={today}
              byDay={byDay}
              onPick={setOpenDay}
            />
          )}
        </CardContent>
      </Card>

      <DayDialog
        day={openDay}
        userId={userId}
        data={data}
        onClose={() => setOpenDay(null)}
      />
    </div>
  );
}

// --- Pieces ------------------------------------------------------------------

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string | null | undefined;
  hint?: string;
  tone?: "neutral" | "amber" | "green";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5",
        tone === "amber" && "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
        tone === "green" && "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">
        {value === null || value === undefined ? (
          <Skeleton className="h-7 w-12" />
        ) : (
          value.toLocaleString()
        )}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

const COLUMNS: { key: keyof Figures; label: string }[] = [
  { key: "handled", label: "Handled" },
  { key: "confirmed", label: "Confirmed" },
  { key: "from_incomplete", label: "From Incomplete" },
  { key: "no_response", label: "No response" },
  { key: "cancelled", label: "Cancelled" },
  { key: "delivered", label: "Delivered" },
  { key: "returned", label: "Returned" },
];

/** One row per person over the month, most confirmed first. */
function StaffTable({
  data,
  onPick,
}: {
  data: StaffStats;
  onPick: (userId: number) => void;
}) {
  const people = data.staff
    .map((s) => ({
      staff: s,
      f: sum(data.days.filter((r) => r.user_id === s.user_id)),
    }))
    .sort((a, b) => b.f.confirmed - a.f.confirmed || b.f.handled - a.f.handled);
  return (
    <table className="w-full min-w-[44rem] text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Staff</th>
          {COLUMNS.map((c) => (
            <th key={c.key} className="py-2 pr-3 text-right font-medium">
              {c.label}
            </th>
          ))}
          <th className="py-2 text-right font-medium">Delivery rate</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {people.map(({ staff, f }) => (
          <tr key={staff.user_id} className="hover:bg-muted/40">
            <td className="py-2 pr-3">
              <button
                type="button"
                onClick={() => onPick(staff.user_id)}
                className="text-left hover:underline"
              >
                {staffName(staff)}
              </button>
            </td>
            {COLUMNS.map((c) => (
              <td
                key={c.key}
                className={cn(
                  "py-2 pr-3 text-right tabular-nums",
                  f[c.key] === 0 && "text-muted-foreground/60",
                  c.key === "delivered" && f[c.key] > 0 && "font-medium text-emerald-700 dark:text-emerald-400"
                )}
              >
                {f[c.key]}
              </td>
            ))}
            <td className="py-2 text-right tabular-nums">{deliveryRate(f)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Calendar({
  month,
  today,
  byDay,
  onPick,
}: {
  month: string;
  today: string;
  byDay: Map<string, Figures>;
  onPick: (day: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      {calendarWeeks(month).map((week, i) => (
        <div key={i} className="grid grid-cols-7 gap-1.5">
          {week.map((day, j) => {
            if (!day) return <div key={j} />;
            const f = byDay.get(day);
            const future = day > today;
            return (
              <button
                key={day}
                type="button"
                disabled={future || !f}
                onClick={() => onPick(day)}
                className={cn(
                  "flex min-h-20 flex-col rounded-md border p-1.5 text-left text-[11px] leading-tight transition-colors sm:min-h-24 sm:p-2 sm:text-xs",
                  f && !future ? "hover:bg-accent" : "cursor-default",
                  future && "opacity-40",
                  day === today && "border-primary ring-1 ring-primary"
                )}
              >
                <span className="mb-1 font-medium text-muted-foreground">
                  {Number(day.slice(8))}
                </span>
                {f && (
                  <span className="flex flex-col gap-0.5 tabular-nums">
                    <span>
                      <b className="font-semibold">{f.confirmed}</b>
                      <span className="hidden sm:inline"> confirmed</span>
                      <span className="sm:hidden"> ✓</span>
                    </span>
                    {f.from_incomplete > 0 && (
                      <span className="text-amber-700 dark:text-amber-400">
                        {f.from_incomplete}
                        <span className="hidden sm:inline"> incomplete</span>
                        <span className="sm:hidden"> inc</span>
                      </span>
                    )}
                    <span className="text-emerald-700 dark:text-emerald-400">
                      {f.delivered}
                      <span className="hidden sm:inline"> delivered</span>
                      <span className="sm:hidden"> del</span>
                    </span>
                    <span className="hidden text-muted-foreground sm:inline">
                      {f.handled} handled
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A day opened up: for one person, the orders they confirmed and where those
 *  are now; for the team, who did what that day. */
function DayDialog({
  day,
  userId,
  data,
  onClose,
}: {
  day: string | null;
  userId: number | null;
  data: StaffStats | null;
  onClose: () => void;
}) {
  const [orders, setOrders] = React.useState<StaffDayOrder[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!day || userId === null) return;
    let cancelled = false;
    setOrders(null);
    setError(null);
    getStaffDayOrders(userId, day)
      .then((r) => {
        if (!cancelled) setOrders(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [day, userId]);

  const staff = new Map((data?.staff ?? []).map((s) => [s.user_id, s]));
  const team = (data?.days ?? [])
    .filter((r) => r.day === day)
    .sort((a, b) => b.confirmed - a.confirmed || b.handled - a.handled);

  return (
    <Dialog open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {userId === null ? "The team" : staffName(staff.get(userId))}
          </DialogTitle>
          <DialogDescription>
            {day && dayLabel(day)} —{" "}
            {userId === null
              ? "who did what."
              : "orders they confirmed, and where they are now."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex-1 overflow-y-auto px-6">
          {userId === null ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Staff</th>
                  <th className="py-2 pr-3 text-right font-medium">Confirmed</th>
                  <th className="py-2 pr-3 text-right font-medium">Incomplete</th>
                  <th className="py-2 pr-3 text-right font-medium">Delivered</th>
                  <th className="py-2 text-right font-medium">Handled</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {team.map((r) => (
                  <tr key={r.user_id}>
                    <td className="py-2 pr-3">{staffName(staff.get(r.user_id))}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.confirmed}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.from_incomplete}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.delivered}</td>
                    <td className="py-2 text-right tabular-nums">{r.handled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : error ? (
            <p className="py-6 text-sm text-destructive">{error}</p>
          ) : orders === null ? (
            <Skeleton className="h-40 w-full" />
          ) : orders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No orders confirmed this day.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {orders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted-foreground tabular-nums">
                      {new Date(o.confirmed_at).toLocaleTimeString("en-GB", {
                        timeZone: "Asia/Dhaka",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{o.order_no}</td>
                    <td className="max-w-40 truncate py-2 pr-3">
                      {o.customer_name}
                      {o.source === "incomplete" && (
                        <span className="ml-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                          incomplete
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right text-xs",
                        o.delivered
                          ? "font-medium text-emerald-700 dark:text-emerald-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {o.delivered
                        ? "Delivered"
                        : o.pathao_status?.replace(/_/g, " ") ||
                          ORDER_STATUS_LABELS[o.status as OrderStatus] ||
                          o.status}
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
