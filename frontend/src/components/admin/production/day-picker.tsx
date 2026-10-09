"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listProductionDays, type ProductionDaySummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dayLabel, isoOf, taka } from "./format";

const WEEKDAYS = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"];

/** First of the month of a YYYY-MM-DD day, as a UTC Date. */
export function monthOf(iso: string): Date {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function lastOf(month: Date): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
}

/** The production days of a month, by day; null while loading. */
export function useMonthDays(
  month: Date,
  version: number,
  enabled = true
): Map<string, ProductionDaySummary> | null {
  const start = isoOf(month);
  const end = isoOf(lastOf(month));
  const [state, setState] = React.useState<{
    key: string;
    days: Map<string, ProductionDaySummary>;
  } | null>(null);
  const key = `${start}:${version}`;

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listProductionDays({ start, end, limit: 31 })
      .then((rows) => !cancelled && setState({ key, days: new Map(rows.map((r) => [r.day, r])) }))
      .catch(() => !cancelled && setState({ key, days: new Map() }));
    return () => {
      cancelled = true;
    };
  }, [start, end, key, enabled]);

  return state?.key === key ? state.days : null;
}

/**
 * A month grid. Production days are tinted, the picked day is filled, and
 * days after `max` cannot be picked. Weeks start on Saturday, as the
 * working week does here. The month shown is the caller's, so it can move
 * independently of the picked day.
 */
export function MonthCalendar({
  size = "sm",
  month,
  onMonth,
  value,
  max,
  days,
  onPick,
}: {
  /** lg: taller cells, each cook day showing its jars. */
  size?: "sm" | "lg";
  month: Date;
  onMonth: (month: Date) => void;
  value: string;
  max: string;
  days: Map<string, ProductionDaySummary> | null;
  onPick: (day: string) => void;
}) {
  const lead = (month.getUTCDay() + 1) % 7;
  const count = lastOf(month).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) =>
      isoOf(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1)))
    ),
  ];
  const shift = (n: number) =>
    onMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)));
  const atLatest = isoOf(lastOf(month)) >= max;
  const lg = size === "lg";

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="text-sm font-medium">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          disabled={atLatest}
          onClick={() => shift(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className={cn("grid grid-cols-7 text-center", lg ? "gap-1.5" : "gap-1")}>
        {WEEKDAYS.map((w) => (
          <div key={w} className={cn("py-1 text-muted-foreground", lg ? "text-xs" : "text-[11px]")}>
            {w}
          </div>
        ))}
        {cells.map((iso, i) => {
          if (iso === null) return <div key={`lead-${i}`} />;
          const cooked = days?.get(iso);
          const picked = iso === value;
          return (
            <button
              key={iso}
              type="button"
              disabled={iso > max}
              onClick={() => onPick(iso)}
              title={
                cooked
                  ? `${dayLabel(iso)}: ${cooked.jars.toLocaleString("en-IN")} jars, ${taka(cooked.total_cost)}`
                  : dayLabel(iso)
              }
              aria-label={`${dayLabel(iso)}${cooked ? ", production day" : ""}`}
              aria-current={picked ? "date" : undefined}
              className={cn(
                "flex flex-col items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                lg ? "h-14 gap-0.5 sm:h-16" : "h-8",
                " hover:bg-accent disabled:pointer-events-none disabled:opacity-30",
                iso === max && "ring-1 ring-inset ring-foreground/20",
                cooked && "bg-primary/15 font-semibold text-primary hover:bg-primary/25",
                picked && "bg-primary text-primary-foreground hover:bg-primary"
              )}
            >
              {Number(iso.slice(8))}
              {lg && cooked && (
                <span className="text-[10px] font-normal leading-none opacity-80">
                  {cooked.jars.toLocaleString("en-IN")} jars
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The page's day, picked from a month calendar in a popover. */
export function DayPicker({
  value,
  max,
  version,
  onChange,
}: {
  value: string;
  max: string;
  /** Bumped after a save or a delete, so the marks stay true. */
  version: number;
  onChange: (day: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(() => monthOf(value));
  const days = useMonthDays(month, version, open);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Opening shows the month of the picked day.
        if (o) setMonth(monthOf(value));
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-48 justify-start gap-2 font-normal">
          <CalendarDays className="size-4 text-muted-foreground" />
          {dayLabel(value, { weekday: true })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <MonthCalendar
          month={month}
          onMonth={setMonth}
          value={value}
          max={max}
          days={days}
          onPick={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
        <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary/15 ring-1 ring-primary/40" /> Production day
          </span>
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => {
              onChange(max);
              setOpen(false);
            }}
          >
            Today
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
