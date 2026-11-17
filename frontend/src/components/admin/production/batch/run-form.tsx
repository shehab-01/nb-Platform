"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { dhakaToday, taka } from "@/components/admin/production/format";
import { count, lineAmount, num, rate } from "@/components/admin/production/batch/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PRODUCTION_UNITS,
  saveProductionRun,
  unitLabel,
  type ProductionRun,
  type ProductionRunDefaults,
  type RunCost,
} from "@/lib/api";

type CostDraft = {
  key: number;
  item: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  followsUnits: boolean;
};

type Draft = {
  name: string;
  openedOn: string;
  units: string;
  piecesPerPacket: string;
  rawKg: string;
  rawCost: string;
  costs: CostDraft[];
  note: string;
};

const NO_UNIT = "none";
const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const DECIMAL3 = /^\d+(\.\d{1,3})?$/;
const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const WHOLE = /^\d+$/;

let lastKey = 0;
/** A key for a new line: lines are added and removed, so not their index. */
function newKey(): number {
  lastKey += 1;
  return lastKey;
}

function costDraft(c: RunCost, keepQuantity: boolean): CostDraft {
  return {
    key: newKey(),
    item: c.item,
    unit: c.unit ?? NO_UNIT,
    quantity: keepQuantity && !c.followsUnits ? text(c.quantity) : "",
    unitPrice: text(c.unitPrice),
    followsUnits: c.followsUnits,
  };
}

function defaultName(day: string): string {
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Production ${label}`;
}

/**
 * Opening a batch production, or correcting an open one: the order (how
 * many packets, how many pieces in each), the raw material bought for it,
 * and every other thing bought for the whole order as quantity × unit price.
 * Quantities not known yet stay blank and cost nothing until filled in.
 * Amounts show while typing; the server works them out again on save.
 */
export function RunForm({
  run,
  defaults,
}: {
  /** null when opening a new one. */
  run: ProductionRun | null;
  defaults: ProductionRunDefaults;
}) {
  const router = useRouter();
  const { can } = useAuth();
  const admin = can("production.admin");
  const today = dhakaToday();
  const [d, setD] = React.useState<Draft>(() =>
    run
      ? {
          name: run.name,
          openedOn: run.openedOn,
          units: String(run.units),
          piecesPerPacket: String(run.piecesPerPacket),
          rawKg: text(run.rawKg),
          rawCost: run.rawCost ? String(run.rawCost) : "",
          costs: run.costs.map((c) => costDraft(c, true)),
          note: run.note ?? "",
        }
      : {
          name: defaultName(today),
          openedOn: today,
          units: "",
          piecesPerPacket: String(defaults.piecesPerPacket),
          rawKg: "",
          rawCost: "",
          costs: defaults.costs.map((c) => costDraft(c, false)),
          note: "",
        }
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Problems show once Save was pressed, not while the form is still empty.
  const [tried, setTried] = React.useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((p) => ({ ...p, [key]: value }));
  const setCost = (key: number, patch: Partial<CostDraft>) =>
    setD((p) => ({ ...p, costs: p.costs.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));

  const units = WHOLE.test(d.units) ? Number(d.units) : 0;
  const lineQuantity = (c: CostDraft) => (c.followsUnits ? units : num(c.quantity));
  const amounts = d.costs.map((c) => lineAmount(lineQuantity(c), num(c.unitPrice)));
  const rawCost = WHOLE.test(d.rawCost) ? Number(d.rawCost) : 0;
  const upFront = rawCost + amounts.reduce((s, a) => s + a, 0);

  const problems: string[] = [];
  if (!d.name.trim()) problems.push("Give the production a name.");
  if (units < 1) problems.push("How many packets is the order?");
  if (!WHOLE.test(d.piecesPerPacket) || Number(d.piecesPerPacket) < 1)
    problems.push("Pieces per packet must be a whole number.");
  if (d.rawKg.trim() && !DECIMAL3.test(d.rawKg.trim())) problems.push("Raw material kg is not a number.");
  if (d.rawCost.trim() && !WHOLE.test(d.rawCost.trim()))
    problems.push("Raw material cost is whole taka.");
  for (const c of d.costs) {
    if (!c.item.trim()) continue;
    if (!c.followsUnits && c.quantity.trim() && !DECIMAL3.test(c.quantity.trim()))
      problems.push(`${c.item}: the quantity is not a number.`);
    if (c.unitPrice.trim() && !DECIMAL2.test(c.unitPrice.trim()))
      problems.push(`${c.item}: the price is not a number (up to 2 decimals).`);
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problems.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveProductionRun(
        {
          name: d.name.trim(),
          openedOn: d.openedOn,
          units,
          piecesPerPacket: Number(d.piecesPerPacket),
          rawKg: d.rawKg.trim() || null,
          rawCost,
          costs: d.costs
            .filter((c) => c.item.trim())
            .map((c) => ({
              item: c.item.trim(),
              unit: c.unit === NO_UNIT ? null : c.unit,
              quantity: c.followsUnits ? null : c.quantity.trim() || null,
              unitPrice: c.unitPrice.trim() || null,
              followsUnits: c.followsUnits,
            })),
          note: d.note.trim() || null,
        },
        run?.id
      );
      router.push(`/admin/crm/production/runs/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  // Writers open productions today and never re-date one.
  const dateLocked = !admin;

  return (
    <form onSubmit={submit} className="@container grid gap-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {run ? `Edit ${run.name}` : "Open production"}
      </h1>

      {/* --- 1. The order --- */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle>1 · The order</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 @2xl:grid-cols-2">
          <Field label="Name" htmlFor="run-name">
            <Input id="run-name" value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
          </Field>
          <Field
            label="Date"
            htmlFor="run-date"
            hint={dateLocked ? "Today. Only a production admin can pick another day." : undefined}
          >
            <Input
              id="run-date"
              type="date"
              value={d.openedOn}
              max={today}
              disabled={dateLocked}
              onChange={(e) => set("openedOn", e.target.value)}
            />
          </Field>
          <Field label="Production units (packets)" htmlFor="run-units">
            <Input
              id="run-units"
              inputMode="numeric"
              placeholder="12000"
              value={d.units}
              onChange={(e) => set("units", e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <Field
            label="Pieces per packet"
            htmlFor="run-ppp"
            hint={units ? `${count(units * (Number(d.piecesPerPacket) || 0))} pieces in all` : undefined}
          >
            <Input
              id="run-ppp"
              inputMode="numeric"
              value={d.piecesPerPacket}
              onChange={(e) => set("piecesPerPacket", e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
        </CardContent>
      </Card>

      {/* --- 2. Raw material --- */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle>2 · Raw material</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 @2xl:grid-cols-2">
          <Field label="Bought (kg)" htmlFor="run-raw-kg">
            <Input
              id="run-raw-kg"
              inputMode="decimal"
              placeholder="200"
              value={d.rawKg}
              onChange={(e) => set("rawKg", e.target.value)}
            />
          </Field>
          <Field label="Cost (৳, total)" htmlFor="run-raw-cost">
            <Input
              id="run-raw-cost"
              inputMode="numeric"
              placeholder="0"
              value={d.rawCost}
              onChange={(e) => set("rawCost", e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <p className="text-xs text-muted-foreground @2xl:col-span-2">
            How much was used is filled in when the production is closed.
          </p>
        </CardContent>
      </Card>

      {/* --- 3. Bought for the order --- */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle>3 · Bought for this order</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_7rem_2.25rem] gap-2 text-xs font-medium text-muted-foreground @3xl:grid">
            <span>Item</span>
            <span>Unit</span>
            <span>Quantity</span>
            <span>Unit price ৳</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {d.costs.map((c, i) => (
            <div
              key={c.key}
              className="grid grid-cols-2 gap-2 rounded-lg border p-3 @3xl:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_7rem_2.25rem] @3xl:items-center @3xl:border-0 @3xl:p-0"
            >
              <Input
                aria-label="Item"
                className="col-span-2 @3xl:col-span-1"
                placeholder="Item"
                value={c.item}
                maxLength={120}
                onChange={(e) => setCost(c.key, { item: e.target.value })}
              />
              <Select value={c.unit} onValueChange={(v) => setCost(c.key, { unit: v })}>
                <SelectTrigger aria-label="Unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_UNIT}>—</SelectItem>
                  {PRODUCTION_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {unitLabel(u)} ({u})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {c.followsUnits ? (
                <div
                  className="flex h-9 items-center gap-1.5 rounded-md border bg-muted/50 px-3 text-sm tabular-nums"
                  title="Always the order's units"
                >
                  <Lock className="size-3.5 text-muted-foreground" />
                  {units ? count(units) : "—"}
                </div>
              ) : (
                <Input
                  aria-label="Quantity"
                  inputMode="decimal"
                  placeholder="Later"
                  value={c.quantity}
                  onChange={(e) => setCost(c.key, { quantity: e.target.value })}
                />
              )}
              <Input
                aria-label="Unit price"
                inputMode="decimal"
                placeholder="0.00"
                value={c.unitPrice}
                onChange={(e) => setCost(c.key, { unitPrice: e.target.value })}
              />
              <span className="self-center text-right text-sm font-medium tabular-nums">
                {taka(amounts[i])}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${c.item || "line"}`}
                className="justify-self-end"
                onClick={() => setD((p) => ({ ...p, costs: p.costs.filter((x) => x.key !== c.key) }))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                setD((p) => ({
                  ...p,
                  costs: [
                    ...p.costs,
                    { key: newKey(), item: "", unit: "pcs", quantity: "", unitPrice: "", followsUnits: false },
                  ],
                }))
              }
            >
              <Plus className="size-4" />
              Add item
            </Button>
            <p className="text-xs text-muted-foreground">
              A locked quantity is always the order&apos;s units. Leave a quantity blank until it is known.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4">
        <CardContent className="grid gap-4">
          <Field label="Note" htmlFor="run-note">
            <Textarea id="run-note" rows={2} value={d.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
            <div>
              <div className="text-xs text-muted-foreground">Up-front cost (raw material + items)</div>
              <div className="text-2xl font-semibold tabular-nums">{taka(upFront)}</div>
              {units > 0 && upFront > 0 && (
                <div className="text-xs text-muted-foreground">
                  {rate(Math.round((upFront / units) * 100) / 100)} per packet ordered, before slot costs
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={busy} className="gap-1.5">
                {busy && <Loader2 className="size-4 animate-spin" />}
                {run ? "Save changes" : "Open production"}
              </Button>
            </div>
          </div>
          {(error || (tried && problems.length > 0)) && (
            <div role="alert" className="text-sm text-destructive">
              {error ?? problems[0]}
            </div>
          )}
        </CardContent>
      </Card>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
