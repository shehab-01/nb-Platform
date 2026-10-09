"use client";

import * as React from "react";
import {
  CalendarClock,
  ChefHat,
  Clock3,
  CookingPot,
  CalendarRange,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  ShoppingBasket,
  StickyNote,
  Users,
  Wallet,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useAuth } from "@/components/admin/auth-context";
import { ProductIcon } from "@/components/admin/production/product-icons";
import {
  DayPicker,
  MonthCalendar,
  monthOf,
  useMonthDays,
} from "@/components/admin/production/day-picker";
import {
  clock,
  dayLabel,
  dhakaToday,
  taka,
  takaPaisa,
} from "@/components/admin/production/format";
import { ProductionSheet } from "@/components/admin/production/production-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProductionDay,
  getProductionSuggestions,
  listProductionItems,
  listProductionProducts,
  listProductionDays,
  type ProductionItem,
  type ProductionProduct,
  type ProductionDay,
  type ProductionDaySummary,
  type ProductionSuggestions,
  unitLabel,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type SheetState = { editing: ProductionDay | null; template: ProductionDay | null } | null;

/**
 * Production Cost, per store, for the people with CRM access: what a day of
 * cooking costs, down to the jar. A day is a production day once it has been
 * saved here; pick any day to see it as it was saved. This page is a
 * costing — it neither reads nor writes Expenses.
 */
export default function ProductionPage() {
  const { store, can } = useAuth();
  if (!store || !can("crm")) {
    return (
      <p className="text-sm text-muted-foreground">
        The CRM is open to super admins and the people they give access to.
      </p>
    );
  }
  return <ProductionView key={store.storeId} />;
}

function ProductionView() {
  const today = dhakaToday();
  const [day, setDay] = React.useState(today);
  // undefined while loading; null when the day is not a production day.
  const [record, setRecord] = React.useState<ProductionDay | null | undefined>(undefined);
  const [recent, setRecent] = React.useState<ProductionDaySummary[] | null>(null);
  const [products, setProducts] = React.useState<ProductionProduct[]>([]);
  const [items, setItems] = React.useState<ProductionItem[]>([]);
  const [suggestions, setSuggestions] = React.useState<ProductionSuggestions>({
    purposes: [],
  });
  const [error, setError] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<SheetState>(null);
  const [opening, setOpening] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  const reload = React.useCallback(() => setVersion((v) => v + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setRecord(undefined);
    getProductionDay(day)
      .then((r) => {
        if (cancelled) return;
        setRecord(r);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [day, version]);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      listProductionDays({ limit: 10 }),
      listProductionProducts(),
      listProductionItems(),
      getProductionSuggestions(),
    ])
      .then(([r, p, i, s]) => {
        if (cancelled) return;
        setRecent(r);
        setProducts(p);
        setItems(i);
        setSuggestions(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  /** A new day starts from the latest production day before it. */
  const start = async () => {
    if (opening) return;
    const latest = recent?.find((r) => r.day < day);
    if (!latest) {
      setSheet({ editing: null, template: null });
      return;
    }
    setOpening(true);
    try {
      setSheet({ editing: null, template: await getProductionDay(latest.day) });
    } catch {
      setSheet({ editing: null, template: null });
    } finally {
      setOpening(false);
    }
  };

  const latest = recent?.find((r) => r.day !== day) ?? null;

  return (
    <div className="@container pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Cost</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            প্রতিদিনের রান্নার খরচ, প্রতি জার পর্যন্ত হিসাব।
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {record !== undefined && (
            <span
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium",
                record
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  record ? "bg-primary" : "bg-muted-foreground/50"
                )}
              />
              {record ? "Production day" : "No production"}
            </span>
          )}
          <DayPicker value={day} max={today} version={version} onChange={setDay} />
          {record ? (
            <Button
              variant="outline"
              onClick={() => setSheet({ editing: record, template: null })}
              className="gap-1.5"
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          ) : (
            record === null && (
              <Button onClick={start} disabled={opening} className="gap-1.5">
                <Plus className="size-4" />
                Start production day
              </Button>
            )
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {record === undefined ? (
        <div className="mt-6 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : record ? (
        <DayDashboard record={record} products={products} />
      ) : (
        <NoProduction
          day={day}
          latest={latest}
          opening={opening}
          onStart={start}
          onPick={setDay}
        />
      )}

      {/* History: every cook day, a month at a time. */}
      <CookDaysCalendar
        className="mt-4"
        day={day}
        max={today}
        version={version}
        onPick={setDay}
      />

      {sheet && (
        <ProductionSheet
          key={sheet.editing ? `edit-${day}` : `new-${day}`}
          day={day}
          editing={sheet.editing}
          template={sheet.template}
          products={products}
          items={items}
          suggestions={suggestions}
          onProducts={setProducts}
          onItems={setItems}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            reload();
          }}
          onDeleted={() => {
            setSheet(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// --- Not a production day ----------------------------------------------------------

function NoProduction({
  day,
  latest,
  opening,
  onStart,
  onPick,
}: {
  day: string;
  latest: ProductionDaySummary | null;
  opening: boolean;
  onStart: () => void;
  onPick: (day: string) => void;
}) {
  return (
    <Card className="mt-6">
      <CardContent className="flex flex-col items-center px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <CookingPot className="size-6 text-muted-foreground" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">
          No production on {dayLabel(day, { weekday: true })}
        </h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          এই দিন রান্না হয়নি, বা এখনো লেখা হয়নি। প্রোডাকশন দিন শুরু করলে বাজার, রাঁধুনি
          আর কী রান্না হলো লেখা যাবে, আর প্রতি জারের খরচ হিসাব হবে।
        </p>
        <Button onClick={onStart} disabled={opening} className="mt-5 gap-1.5">
          <Plus className="size-4" />
          Start production day
        </Button>
        {latest && (
          <button
            type="button"
            onClick={() => onPick(latest.day)}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            সর্বশেষ প্রোডাকশন দিন দেখুন, {dayLabel(latest.day)} →
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// --- A production day ----------------------------------------------------------------

function DayDashboard({
  record,
  products,
}: {
  record: ProductionDay;
  products: ProductionProduct[];
}) {
  const iconOf = (name: string) => products.find((p) => p.name === name)?.icon;
  const cooks = record.male_cooks + record.female_cooks;

  return (
    <>
      {/* --- Four figures --- */}
      <div className="mt-6 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <StatTile
          label="Jars produced"
          value={record.jars.toLocaleString("en-IN")}
          note={`${record.batches.length}টি পণ্য`}
        />
        <StatTile
          label="Batches"
          value={record.patils.toLocaleString("en-IN")}
          note="পাতিল রান্না হয়েছে"
        />
        <StatTile
          label="Total production cost"
          value={taka(record.total_cost)}
          note="দিনের মোট খরচ"
        />
        <StatTile
          label="Cost per jar"
          value={takaPaisa(record.cost_per_jar)}
          note={`${record.jars.toLocaleString("en-IN")} জারের হিসাবে`}
          emphasis
        />
      </div>

      {/* --- The team, the shifts, the pay --- */}
      <div className="mt-4 grid gap-4 @4xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              Cooks
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            {(
              [
                ["Male", record.male_cooks],
                ["Female", record.female_cooks],
                ["Total", cooks],
              ] as const
            ).map(([label, n], i) => (
              <div
                key={label}
                className={cn("rounded-lg border p-3", i === 2 && "border-primary/30 bg-primary/5")}
              >
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{n}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="size-4 text-muted-foreground" />
              Time & shifts
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Production time</span>
              <span className="tabular-nums">
                {record.starts_at || record.ends_at
                  ? `${clock(record.starts_at)} – ${clock(record.ends_at)}`
                  : "—"}
              </span>
            </div>
            {record.shifts.length === 0 ? (
              <p className="text-muted-foreground">কোনো শিফট লেখা হয়নি।</p>
            ) : (
              record.shifts.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                  <span>Shift {i + 1}</span>
                  <span className="tabular-nums">
                    {clock(s.starts)} – {clock(s.ends)}
                    {s.cooks !== null && (
                      <span className="ml-2 text-muted-foreground">· {s.cooks} cooks</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-4 text-muted-foreground" />
              Cook pay
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {(
              [
                ["Male cooks", record.male_cooks, record.male_rate],
                ["Female cooks", record.female_cooks, record.female_rate],
              ] as const
            ).map(([label, n, rate]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <span>{label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {n} × {taka(rate)}
                  <span className="ml-3 text-foreground">{taka(n * rate)}</span>
                </span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between rounded-md bg-primary/5 px-3 py-2">
              <span className="font-medium">Total labour</span>
              <span className="font-semibold tabular-nums">{taka(record.labour_cost)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- Bazar list beside what was cooked and where the money went --- */}
      <div className="mt-4 grid items-start gap-4 @4xl:grid-cols-5">
        <Card className="@4xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBasket className="size-4 text-muted-foreground" />
              Raw materials
              <span className="text-sm font-normal text-muted-foreground">· bazar list</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            {record.materials.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                এই দিন কোনো বাজার লেখা হয়নি।
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="w-8 py-2 font-normal">#</th>
                      <th className="py-2 font-normal">Item</th>
                      <th className="py-2 text-right font-normal">Quantity</th>
                      <th className="py-2 text-right font-normal">Unit price</th>
                      <th className="py-2 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.materials.map((m, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="py-2">{m.item}</td>
                        <td className="py-2 text-right tabular-nums">
                          {m.quantity === null
                            ? "—"
                            : `${m.quantity.toLocaleString("en-IN")}${m.unit ? ` ${unitLabel(m.unit)}` : ""}`}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {m.unit_price === null ? "—" : taka(m.unit_price)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{taka(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/40 font-medium">
                      <td colSpan={4} className="rounded-l-md px-2 py-2.5">
                        Total raw materials
                      </td>
                      <td className="rounded-r-md px-2 py-2.5 text-right font-semibold tabular-nums">
                        {taka(record.materials_cost)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 @4xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ChefHat className="size-4 text-muted-foreground" />
                Products cooked
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_4rem] gap-2 text-xs text-muted-foreground">
                <span>Product</span>
                <span className="text-right">Patils</span>
                <span className="text-right">Per patil</span>
                <span className="text-right">Jars</span>
              </div>
              {record.batches.map((b, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_4rem] items-center gap-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ProductIcon icon={iconOf(b.product)} className="size-3.5" />
                    </span>
                    <span className="truncate">{b.product}</span>
                  </span>
                  <span className="text-right tabular-nums">{b.patils}</span>
                  <span className="text-right tabular-nums">{b.jars_per_patil}</span>
                  <span className="text-right font-medium tabular-nums">
                    {b.jars.toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between rounded-md bg-primary/5 px-3 py-2">
                <span className="font-medium">Total jars produced</span>
                <span className="font-semibold tabular-nums">{record.jars.toLocaleString("en-IN")}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChartIcon className="size-4 text-muted-foreground" />
                Cost breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CostDonut record={record} />
            </CardContent>
          </Card>
        </div>
      </div>

      {(record.misc.length > 0 || record.note) && (
        <div className="mt-4 grid items-start gap-4 @4xl:grid-cols-2">
          {record.misc.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="size-4 text-muted-foreground" />
                  Miscellaneous costs
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {record.misc.map((m, i) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div>{m.purpose}</div>
                      {m.note && <div className="text-xs text-muted-foreground">{m.note}</div>}
                    </div>
                    <span className="tabular-nums">{taka(m.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {record.note && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <StickyNote className="size-4 text-muted-foreground" />
                  Note
                </CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-line text-sm">{record.note}</CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function StatTile({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("gap-1 py-4", emphasis && "border-primary/30 bg-primary/5")}>
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {note && <div className="mt-1 truncate text-xs text-muted-foreground">{note}</div>}
      </CardContent>
    </Card>
  );
}

/** Where the day's money went: five fixed parts, each always in the same
 *  colour slot, with every amount and share in the legend (the labels, not
 *  the colours, are what make it readable). */
function CostDonut({ record }: { record: ProductionDay }) {
  const parts = [
    { label: "Raw materials", amount: record.materials_cost, slot: 1 },
    { label: "Labour", amount: record.labour_cost, slot: 2 },
    { label: "Gas / fuel", amount: record.gas_cost, slot: 3 },
    { label: "Packaging", amount: record.packaging_cost, slot: 4 },
    { label: "Miscellaneous", amount: record.misc_cost, slot: 5 },
  ];
  const total = record.total_cost;
  const shown = parts.filter((p) => p.amount > 0);
  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");

  return (
    <div className="flex flex-col items-center gap-5 @md:flex-row">
      <div className="relative size-40 shrink-0">
        {shown.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={shown}
                dataKey="amount"
                nameKey="label"
                innerRadius="64%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke="var(--card)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {shown.map((p) => (
                  <Cell key={p.label} fill={`var(--cat-${p.slot})`} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                      <div className="text-muted-foreground">{String(payload[0].name)}</div>
                      <div className="font-semibold tabular-nums">
                        {taka(Number(payload[0].value))} · {pct(Number(payload[0].value))}
                      </div>
                    </div>
                  ) : null
                }
              />
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-semibold tabular-nums">{taka(total)}</span>
          <span className="text-xs text-muted-foreground">total cost</span>
        </div>
      </div>
      <ul className="grid w-full min-w-0 gap-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: `var(--cat-${p.slot})` }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{p.label}</span>
            <span className="tabular-nums">{p.amount.toLocaleString("en-IN")}</span>
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {pct(p.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- History ------------------------------------------------------------------------


/**
 * Every cook day, a month at a time: each one tinted and showing its jars,
 * the month in figures beside it. It moves between months on its own,
 * without changing the board; clicking a day opens it above.
 */
function CookDaysCalendar({
  day,
  max,
  version,
  onPick,
  className,
}: {
  day: string;
  max: string;
  version: number;
  onPick: (day: string) => void;
  className?: string;
}) {
  const [month, setMonth] = React.useState(() => monthOf(day));
  const days = useMonthDays(month, version);
  const rows = days ? [...days.values()] : [];
  const jars = rows.reduce((s, r) => s + r.jars, 0);
  const cost = rows.reduce((s, r) => s + r.total_cost, 0);
  const loading = days === null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" />
          Cook days
          <span className="text-sm font-normal text-muted-foreground">
            · দিনে ক্লিক করলে উপরে খুলবে
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_15rem]">
        <MonthCalendar
          size="lg"
          month={month}
          onMonth={setMonth}
          value={day}
          max={max}
          days={days}
          onPick={(d) => {
            onPick(d);
            // Up to the board it changed.
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
        <div className="grid content-start gap-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {month.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
          </div>
          {(
            [
              ["Cook days", String(rows.length)],
              ["Jars produced", jars.toLocaleString("en-IN")],
              ["Total cost", taka(cost)],
              ["Average cost per jar", jars ? takaPaisa(cost / jars) : "—"],
            ] as const
          ).map(([label, value], i) => (
            <div
              key={label}
              className={cn("rounded-lg border p-3", i === 3 && "border-primary/30 bg-primary/5")}
            >
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">
                {loading ? <Skeleton className="h-6 w-20" /> : value}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-primary/15 ring-1 ring-primary/40" />
              রান্নার দিন
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-primary" />
              উপরে খোলা
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
