"use client";

import * as React from "react";
import {
  Amphora,
  Banknote,
  CalendarDays,
  ChefHat,
  Clock3,
  Coins,
  CookingPot,
  Flame,
  Leaf,
  Package,
  PieChart as PieChartIcon,
  Shapes,
  ShoppingBasket,
  ShoppingCart,
  StickyNote,
  User,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { type ProductionDay, type ProductionProduct, unitLabel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { clock, dayLabel, dhakaToday, taka, takaPaisa } from "./format";
import { ProductIcon } from "./product-icons";

/**
 * A saved production as a dashboard, read only: the four figures; the
 * team, its shifts and its pay; the bazar list beside what was cooked; other
 * costs and the note; and, down the right, the day in brief, where the
 * money went and its share of each part.
 */
export function DayDashboard({
  record,
  products,
}: {
  record: ProductionDay;
  products: ProductionProduct[];
}) {
  return (
    <DashboardFrame
      main={
        <>
          <KpiRow record={record} />
          <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
            <WorkforceCard record={record} />
            <ShiftCard record={record} />
            <SalaryCard record={record} />
          </div>
          <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="grid gap-4">
              <MaterialsCard record={record} />
              <OtherCostsCard record={record} />
            </div>
            <CookingCard record={record} products={products} />
          </div>
        </>
      }
      rail={<SummaryRail record={record} />}
    />
  );
}

/** The page's two columns: the main board, and a rail on the right. */
export function DashboardFrame({ main, rail }: { main: React.ReactNode; rail: React.ReactNode }) {
  return (
    <div className="mt-6 grid items-start gap-4 @6xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="grid min-w-0 gap-4">{main}</div>
      <div className="grid gap-4">{rail}</div>
    </div>
  );
}

// --- Pieces -----------------------------------------------------------------------

function Panel({
  icon: Icon,
  title,
  aside,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <PanelHeader icon={Icon} title={title} aside={aside} />
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

/** A card's heading: the icon in a tinted circle and a larger title,
 *  ruled off from what follows. */
function PanelHeader({
  icon: Icon,
  title,
  aside,
}: {
  icon: LucideIcon;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <h3 className="text-base font-semibold">{title}</h3>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

/** A tinted bar closing a card: "Total labour cost … ৳4,300". */
export function TotalBar({
  label,
  className = "mt-3",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      <span className="text-base font-semibold tabular-nums">{children}</span>
    </div>
  );
}

export function KpiRow({ record }: { record: ProductionDay }) {
  const n = record.batches.length;
  return (
    <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
      <Kpi
        icon={Amphora}
        label="Total jars produced"
        value={record.jars.toLocaleString("en-IN")}
        note={`(${n}টি পণ্য)`}
      />
      <Kpi
        icon={CookingPot}
        label="Total cooking batches"
        value={record.patils.toLocaleString("en-IN")}
        note="(মোট পাতিল)"
      />
      <Kpi
        icon={Wallet}
        label="Total production cost"
        value={taka(record.total_cost)}
        note="(এই দিনের রান্নার মোট খরচ)"
      />
      <Kpi
        icon={Banknote}
        label="Cost per jar (avg.)"
        value={record.jars ? takaPaisa(record.cost_per_jar) : "—"}
        note={`(${record.jars.toLocaleString("en-IN")} জার হিসেবে)`}
      />
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-start gap-3 px-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{label}</div>
          <div className="mt-1 truncate text-2xl font-bold tabular-nums @7xl:text-3xl">{value}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{note}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkforceCard({ record }: { record: ProductionDay }) {
  const tiles: [LucideIcon, string, number, string][] = [
    [User, "Male cook", record.male_cooks, "bg-muted/60"],
    [UserRound, "Female cook", record.female_cooks, "bg-muted/60"],
    [Users, "Total cook", record.male_cooks + record.female_cooks, "bg-primary/10"],
  ];
  return (
    <Panel icon={Users} title="Workforce" aside="(Today)">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([Icon, label, n, tint]) => (
          <div key={label} className={cn("flex flex-col items-center rounded-lg p-3 text-center", tint)}>
            <Icon className="size-5 text-primary" />
            <span className="mt-1.5 text-[11px] text-muted-foreground">{label}</span>
            <span className="text-2xl font-bold tabular-nums">{n}</span>
            <span className="text-[11px] text-muted-foreground">জন</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ShiftCard({ record }: { record: ProductionDay }) {
  return (
    <Panel icon={Clock3} title="Shift information">
      <div className="flex divide-x rounded-lg border">
        <div className="shrink-0 px-3 py-2.5">
          <div className="text-xs text-muted-foreground">Total shift</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{record.shifts.length}</div>
        </div>
        {record.shifts.length === 0 ? (
          <div className="flex items-center px-3 text-xs text-muted-foreground">
            কোনো শিফট লেখা হয়নি।
          </div>
        ) : (
          <div className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col divide-x">
            {record.shifts.map((s, i) => (
              <div key={i} className="min-w-0 px-3 py-2.5 text-xs">
                <div className="text-muted-foreground">Shift {i + 1}</div>
                <div className="mt-1 font-medium tabular-nums">
                  {clock(s.starts)} – {clock(s.ends)}
                </div>
                {s.cooks !== null && <div className="text-muted-foreground">({s.cooks} জন)</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      {(record.starts_at || record.ends_at) && (
        <p className="mt-2 text-xs text-muted-foreground">
          Production time: {clock(record.starts_at)} – {clock(record.ends_at)}
        </p>
      )}
    </Panel>
  );
}

function SalaryCard({ record }: { record: ProductionDay }) {
  const rows: [LucideIcon, string, number, number][] = [
    [User, "Male cook", record.male_cooks, record.male_rate],
    [UserRound, "Female cook", record.female_cooks, record.female_rate],
  ];
  return (
    <Panel icon={Coins} title="Cook salary" aside="(Today)">
      <div className="grid gap-2.5 text-sm">
        {rows.map(([Icon, label, n, rate]) => (
          <div key={label} className="flex items-center gap-2">
            <Icon className="size-4 text-primary" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-muted-foreground tabular-nums">
              {n} × {taka(rate)} =
            </span>
            <span className="w-20 text-right font-semibold tabular-nums">{taka(n * rate)}</span>
          </div>
        ))}
      </div>
      <TotalBar label="Total labour cost">{taka(record.labour_cost)}</TotalBar>
    </Panel>
  );
}

function MaterialsCard({ record }: { record: ProductionDay }) {
  return (
    <Panel icon={ShoppingCart} title="Raw materials" aside="(Bazar list)">
      {record.materials.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">এই দিন কোনো বাজার লেখা হয়নি।</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-96 text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr className="text-left">
                <th className="w-8 px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Quantity</th>
                <th className="px-3 py-2 text-right font-medium">Unit price (৳)</th>
                <th className="px-3 py-2 text-right font-medium">Total (৳)</th>
              </tr>
            </thead>
            <tbody>
              {record.materials.map((m, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2">{m.item}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {m.quantity === null
                      ? "—"
                      : `${m.quantity.toLocaleString("en-IN")}${m.unit ? ` ${unitLabel(m.unit)}` : ""}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {m.unit_price === null ? "—" : m.unit_price.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {m.amount.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TotalBar label="Total raw material cost">{taka(record.materials_cost)}</TotalBar>
    </Panel>
  );
}

function CookingCard({
  record,
  products,
}: {
  record: ProductionDay;
  products: ProductionProduct[];
}) {
  const iconOf = (name: string) => products.find((p) => p.name === name)?.icon;
  return (
    <Panel icon={CookingPot} title="Cooking details" aside="(প্রতি পণ্যের জন্য)">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-80 text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-2 py-2 text-center font-medium">No. of patil</th>
              <th className="px-2 py-2 text-center font-medium">Per patil (jar)</th>
              <th className="px-3 py-2 text-right font-medium">Total jar</th>
            </tr>
          </thead>
          <tbody>
            {record.batches.map((b, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ProductIcon icon={iconOf(b.product)} className="size-4" />
                    </span>
                    <span className="truncate font-medium">{b.product}</span>
                  </span>
                </td>
                <td className="px-2 py-2.5 text-center tabular-nums">{b.patils}</td>
                <td className="px-2 py-2.5 text-center tabular-nums">{b.jars_per_patil}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {b.jars.toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TotalBar label="Total jar produced">{record.jars.toLocaleString("en-IN")}</TotalBar>
    </Panel>
  );
}

function OtherCostsCard({ record }: { record: ProductionDay }) {
  return (
    <Panel icon={StickyNote} title="Other costs & note">
      <div className="grid gap-2 text-sm">
        <Line label="Gas / fuel" amount={record.gas_cost} />
        <Line label="Packaging" amount={record.packaging_cost} />
        {record.misc.map((m, i) => (
          <Line key={i} label={m.purpose} note={m.note} amount={m.amount} />
        ))}
        {record.note && (
          <p className="mt-1 whitespace-pre-line rounded-lg bg-muted/50 px-3 py-2 text-muted-foreground">
            {record.note}
          </p>
        )}
      </div>
    </Panel>
  );
}

function Line({ label, note, amount }: { label: string; note?: string | null; amount: number }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div>{label}</div>
        {note && <div className="text-xs text-muted-foreground">{note}</div>}
      </div>
      <span className="tabular-nums">{taka(amount)}</span>
    </div>
  );
}

// --- The rail ----------------------------------------------------------------------

/** The five parts of a day's cost, each with its icon and colour slot. */
export function costParts(record: ProductionDay) {
  return [
    { label: "Raw materials (bazar)", short: "Raw materials", amount: record.materials_cost, Icon: ShoppingBasket, slot: 1 },
    { label: "Labour cost (male + female)", short: "Labour cost", amount: record.labour_cost, Icon: Users, slot: 2 },
    { label: "Gas / fuel", short: "Gas / fuel", amount: record.gas_cost, Icon: Flame, slot: 3 },
    { label: "Packaging", short: "Packaging", amount: record.packaging_cost, Icon: Package, slot: 4 },
    { label: "Miscellaneous", short: "Miscellaneous", amount: record.misc_cost, Icon: Shapes, slot: 5 },
  ];
}

const share = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");

/** Down the right: the day in brief, where the money went, the total, and
 *  each part's share as a donut. */
export function SummaryRail({ record }: { record: ProductionDay }) {
  const parts = costParts(record);
  const isToday = record.day === dhakaToday();
  return (
    <>
      {/* --- The day in brief --- */}
      <Card className="relative gap-3 overflow-hidden border-0 bg-primary py-5 text-primary-foreground">
        <Leaf className="pointer-events-none absolute -right-4 -bottom-6 size-32 opacity-10" aria-hidden />
        <CardContent className="grid gap-3 px-5">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <ChefHat className="size-5" />
            {isToday ? "Today's production" : "Production"}
          </div>
          <dl className="grid grid-cols-[3.5rem_auto_1fr] gap-x-2 gap-y-1 text-sm">
            <dt className="opacity-80">Date</dt>
            <dd>:</dd>
            <dd>{dayLabel(record.day)}</dd>
            <dt className="opacity-80">Time</dt>
            <dd>:</dd>
            <dd className="tabular-nums">
              {record.starts_at || record.ends_at
                ? `${clock(record.starts_at)} – ${clock(record.ends_at)}`
                : "—"}
            </dd>
          </dl>
          <span className="w-fit rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-semibold">
            {record.batches.length} types of product
          </span>
          <ul className="grid gap-1.5 text-sm">
            {record.batches.map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-full bg-primary-foreground/70" />
                <span className="truncate">{b.product}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* --- Where the money went --- */}
      <Card className="gap-0 py-0">
        <PanelHeader icon={PieChartIcon} title="Total cost breakdown" />
        <CardContent className="grid px-4 py-2">
          {parts.map(({ label, amount, Icon }) => (
            <div key={label} className="flex items-center gap-2.5 border-b py-2 text-sm last:border-0">
              <Icon className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
              <span className="font-semibold tabular-nums">{taka(amount)}</span>
              <span className="w-11 text-right text-xs text-muted-foreground tabular-nums">
                {share(amount, record.total_cost)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <TotalCostBlock total={record.total_cost} />

      {/* --- Each part's share --- */}
      <Card className="gap-0 py-0">
        <PanelHeader icon={PieChartIcon} title="Cost distribution" />
        <CardContent className="p-4">
          <CostDonut record={record} />
        </CardContent>
      </Card>
    </>
  );
}

/** The day's total on the theme colour: "Total production cost ৳48,750". */
export function TotalCostBlock({ total, className }: { total: number; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl bg-primary px-5 py-4 text-primary-foreground",
        className
      )}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
        <Coins className="size-6" />
      </span>
      <div className="min-w-0">
        <div className="text-sm opacity-90">Total production cost</div>
        <div className="truncate text-2xl font-bold tabular-nums">{taka(total)}</div>
      </div>
    </div>
  );
}

/** Each part's share as a donut, the total in its middle and every amount
 *  and share in the legend (the labels, not the colours, carry it). */
function CostDonut({ record }: { record: ProductionDay }) {
  const parts = costParts(record);
  const total = record.total_cost;
  const shown = parts.filter((p) => p.amount > 0);

  return (
    <div className="flex items-center gap-4">
      <div className="relative size-32 shrink-0">
        {shown.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={shown}
                dataKey="amount"
                nameKey="short"
                innerRadius="62%"
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
                        {taka(Number(payload[0].value))} · {share(Number(payload[0].value), total)}
                      </div>
                    </div>
                  ) : null
                }
              />
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold tabular-nums">{taka(total)}</span>
          <span className="text-[10px] text-muted-foreground">Total cost</span>
        </div>
      </div>
      <ul className="grid min-w-0 flex-1 gap-1.5 text-xs">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: `var(--cat-${p.slot})` }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{p.short}</span>
            <span className="text-muted-foreground tabular-nums">{share(p.amount, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The top of a production page: the title beside a cooking icon, and on
 *  the right the date, then whatever the page adds (Edit, …). */
export function ProductionHeader({
  title,
  subtitle,
  day,
  children,
}: {
  title: string;
  subtitle: string;
  day: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ChefHat className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {day && (
          <div className="flex h-12 items-center gap-2.5 rounded-xl border bg-card px-4">
            <CalendarDays className="size-5 text-primary" />
            <div className="leading-tight">
              <div className="text-[11px] text-muted-foreground">Date</div>
              <div className="text-sm font-semibold">{dayLabel(day)}</div>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
