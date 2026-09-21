"use client";

import * as React from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Minus,
  Trophy,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/admin/auth-context";
import { storeTitle } from "@/lib/admin-store";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDashboard,
  getDashboardActivity,
  type Activity,
  type Dashboard,
  type Performer,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// --- Dates, the shop's way ---------------------------------------------------
// Everything below works in YYYY-MM-DD strings that mean Dhaka calendar days;
// arithmetic is done in UTC on purpose so a viewer's own timezone never shifts
// a day boundary.

function dhakaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function fmtDay(iso: string, withYear = false): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "Tuesday, 8 September 2026" — the day the board is describing. */
function fullDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type Preset = "today" | "yesterday" | "month" | "last_month" | "custom";

type Range = { preset: Preset; from: string; to: string };

const QUICK: { preset: Preset; label: string }[] = [
  { preset: "today", label: "Today" },
  { preset: "yesterday", label: "Yesterday" },
];
const EXTENDED: { preset: Preset; label: string }[] = [
  { preset: "month", label: "This month" },
  { preset: "last_month", label: "Last month" },
];

function presetRange(preset: Preset, today: string): Range {
  switch (preset) {
    case "yesterday": {
      const d = addDays(today, -1);
      return { preset, from: d, to: d };
    }
    case "month":
      return { preset, from: monthStart(today), to: today };
    case "last_month": {
      const end = addDays(monthStart(today), -1);
      return { preset, from: monthStart(end), to: end };
    }
    default:
      return { preset: "today", from: today, to: today };
  }
}

function rangeLabel(r: Range): string {
  const named = [...QUICK, ...EXTENDED].find((p) => p.preset === r.preset);
  if (named) return named.label;
  if (r.from === r.to) return fmtDay(r.from, true);
  return `${fmtDay(r.from)} – ${fmtDay(r.to, true)}`;
}

/**
 * The daily target board. The store's admin title ("Nature Bazar — Ecotine")
 * at the top, the month so
 * far beneath it, then the chosen days in detail (today, unless the picker
 * says otherwise), the month's shape as a line, and who confirmed the most.
 */
export default function AdminDashboardPage() {
  const today = dhakaToday();
  const [range, setRange] = React.useState<Range>(() =>
    presetRange("today", today)
  );
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [performer, setPerformer] = React.useState<Performer | null>(null);
  const { store } = useAuth();

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    getDashboard(range.from, range.to)
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
  }, [range]);

  const m = data?.this_month;
  const p = data?.last_month;
  const d = data?.period;

  return (
    <div className="flex flex-col gap-6">
      {/* --- Title, centred --------------------------------------------- */}
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-[#07582d] dark:text-[#7ed3a0]">
          {store ? storeTitle(store) : "Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{fullDate(range.to)}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- The month ------------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Orders this month"
          value={m?.orders}
          previous={p?.orders}
          hint="Landed from the site and from staff"
        />
        <StatTile
          label="Confirmed this month"
          value={m?.confirmed}
          previous={p?.confirmed}
          hint="Web, manual and recovered leads"
        />
        <StatTile
          label="Delivered this month"
          value={m?.delivered}
          previous={p?.delivered}
          hint="Reported delivered by Pathao"
        />
      </div>

      {/* --- The chosen days ------------------------------------------ */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Daily Database</CardTitle>
            <CardDescription className="mt-1">{rangeLabel(range)}</CardDescription>
          </div>
          <RangePicker value={range} today={today} onChange={setRange} />
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              Orders
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MiniTile label="Landed" value={d?.landed} emphasis />
              <MiniTile
                label="In processing"
                value={d?.processing}
                hint="Not touched yet"
              />
              <MiniTile
                label="Confirmed"
                value={d?.confirmed}
                hint="Web, manual and recovered leads"
              />
              <MiniTile label="No response" value={d?.no_response} />
              <MiniTile label="Cancelled" value={d?.cancelled} />
              <MiniTile
                label="Call · WhatsApp · Messenger"
                value={d?.manual}
                hint="Manual orders"
              />
            </div>
          </section>
          {/* Leads sit apart, on their own amber ground, so the two groups
              never read as one run of tiles. */}
          <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <h3 className="mb-3 text-sm font-medium text-amber-900 dark:text-amber-300">
              Incomplete leads
            </h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <MiniTile label="Incomplete - Landed" value={d?.leads} tone="amber" emphasis />
              <MiniTile
                label="Incomplete - In processing"
                value={d?.leads_processing}
                hint="Still on the Incomplete list"
                tone="amber"
              />
              <MiniTile label="Incomplete - Confirmed" value={d?.leads_confirmed} tone="amber" />
            </div>
          </section>
        </CardContent>
      </Card>

      {/* --- The people --------------------------------------------- */}
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-muted-foreground" />
            Best performers
          </CardTitle>
          <CardDescription>
            Top 5 by orders confirmed. Click a name for their history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.performers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No status changes in this period.
            </p>
          ) : (
            <Leaderboard rows={data.performers} onPick={setPerformer} />
          )}
        </CardContent>
      </Card>

      <ActivityDialog
        performer={performer}
        range={range}
        onClose={() => setPerformer(null)}
      />
    </div>
  );
}

// --- The range picker --------------------------------------------------------

function RangePicker({
  value,
  today,
  onChange,
}: {
  value: Range;
  today: string;
  onChange: (r: Range) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(value.from);
  const [to, setTo] = React.useState(value.to);

  React.useEffect(() => {
    if (open) {
      setFrom(value.from);
      setTo(value.to);
    }
  }, [open, value]);

  const pick = (preset: Preset) => {
    onChange(presetRange(preset, today));
    setOpen(false);
  };

  const customValid = from <= to && to <= today;

  const Item = ({
    preset,
    label,
    icon: Icon,
  }: {
    preset: Preset;
    label: string;
    icon: typeof Clock3;
  }) => {
    const selected = value.preset === preset;
    return (
      <button
        type="button"
        onClick={() => pick(preset)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
          selected && "bg-accent font-medium"
        )}
      >
        <Icon className="size-4 text-muted-foreground" />
        <span className="flex-1">{label}</span>
        {selected && <Check className="size-4 text-primary" />}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <CalendarDays className="size-4" />
          {rangeLabel(value)}
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Quick select
        </p>
        {QUICK.map((q) => (
          <Item
            key={q.preset}
            preset={q.preset}
            label={q.label}
            icon={Clock3}
          />
        ))}
        <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Extended range
        </p>
        {EXTENDED.map((q) => (
          <Item key={q.preset} preset={q.preset} label={q.label} icon={CalendarDays} />
        ))}
        <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Custom
        </p>
        <div className="grid gap-2 px-3 pb-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="dash-from" className="text-xs">
                From
              </Label>
              <Input
                id="dash-from"
                type="date"
                value={from}
                max={today}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="dash-to" className="text-xs">
                To
              </Label>
              <Input
                id="dash-to"
                type="date"
                value={to}
                max={today}
                onChange={(e) => e.target.value && setTo(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!customValid}
            onClick={() => {
              onChange({ preset: "custom", from, to });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Tiles -------------------------------------------------------------------

/** A headline figure with how it compares to the month before. */
function StatTile({
  label,
  value,
  previous,
  hint,
}: {
  label: string;
  value: number | undefined;
  previous: number | undefined;
  hint: string;
}) {
  const delta =
    value !== undefined && previous !== undefined && previous > 0
      ? Math.round(((value - previous) / previous) * 100)
      : null;
  const Arrow =
    delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-4xl font-semibold">
          {value === undefined ? (
            <Skeleton className="h-10 w-24" />
          ) : (
            value.toLocaleString()
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
        {value !== undefined && previous !== undefined && (
          <span className="flex items-center gap-1">
            <Arrow
              className={cn(
                "size-3.5",
                delta !== null && delta > 0 && "text-emerald-700 dark:text-emerald-400",
                delta !== null && delta < 0 && "text-red-700 dark:text-red-400"
              )}
              aria-hidden
            />
            <span className="tabular-nums">
              {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`}
            </span>
            <span>vs last month ({previous.toLocaleString()})</span>
          </span>
        )}
        <span>{hint}</span>
      </CardContent>
    </Card>
  );
}

/** One of the period's figures. The emphasised ones are the totals. */
function MiniTile({
  label,
  value,
  hint,
  emphasis = false,
  tone = "neutral",
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  emphasis?: boolean;
  /** Amber for the leads group, so its tiles match their ground. */
  tone?: "neutral" | "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        tone === "amber"
          ? cn(
              "border-amber-200 dark:border-amber-900",
              emphasis ? "bg-amber-100/70 dark:bg-amber-950/60" : "bg-card"
            )
          : emphasis
            ? "bg-muted/60"
            : "bg-card"
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold">
        {value === undefined ? (
          <Skeleton className="h-7 w-12" />
        ) : (
          value.toLocaleString()
        )}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// --- People ------------------------------------------------------------------

/** Ranked, with a bar that reads against the top score; names open history. */
function Leaderboard({
  rows,
  onPick,
}: {
  rows: Performer[];
  onPick: (p: Performer) => void;
}) {
  const top = Math.max(1, ...rows.map((r) => r.confirmed));
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <li key={r.user_id} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => onPick(r)}
                className={cn(
                  "truncate text-left hover:underline",
                  i === 0 && "font-medium"
                )}
              >
                {r.nickname || r.name}
              </button>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              <span className="text-sm font-medium text-foreground tabular-nums">
                {r.confirmed}
              </span>{" "}
              confirmed · {r.handled} handled
            </span>
          </div>
          <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(r.confirmed / top) * 100}%`,
                background: "var(--dash-1)",
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function ActivityDialog({
  performer,
  range,
  onClose,
}: {
  performer: Performer | null;
  range: Range;
  onClose: () => void;
}) {
  const [rows, setRows] = React.useState<Activity[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const multiDay = range.from !== range.to;

  React.useEffect(() => {
    if (!performer) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    getDashboardActivity(performer.user_id, range.from, range.to)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [performer, range]);

  return (
    <Dialog open={performer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{performer?.nickname || performer?.name}</DialogTitle>
          <DialogDescription>
            Orders they confirmed — {rangeLabel(range).toLowerCase()}, newest
            first.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex-1 overflow-y-auto px-6">
          {error ? (
            <p className="py-6 text-sm text-destructive">{error}</p>
          ) : rows === null ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing confirmed.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted-foreground tabular-nums">
                      {new Date(a.created_at).toLocaleString("en-GB", {
                        timeZone: "Asia/Dhaka",
                        hour: "2-digit",
                        minute: "2-digit",
                        ...(multiDay ? { day: "numeric", month: "short" } : {}),
                      })}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{a.order_no}</td>
                    <td className="max-w-40 truncate py-2 pr-3">{a.customer_name}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      from {(a.old_status ?? "").replace(/_/g, " ")}
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
