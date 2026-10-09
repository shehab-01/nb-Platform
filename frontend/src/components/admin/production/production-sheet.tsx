"use client";

import * as React from "react";
import {
  CalendarDays,
  Copy,
  Flame,
  Package,
  Pencil,
  Plus,
  Shapes,
  ShoppingBasket,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteProductionDay,
  deleteProductionItem,
  deleteProductionProduct,
  PRODUCTION_UNITS,
  saveProductionDay,
  saveProductionItem,
  saveProductionProduct,
  type ProductionDay,
  type ProductionDayInput,
  type ProductionItem,
  type ProductionProduct,
  type ProductionSuggestions,
  type ProductionUnit,
  UNIT_LABELS,
  unitLabel,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { PRODUCT_ICONS, ProductIcon } from "./product-icons";
import { dayLabel, taka, takaPaisa } from "./format";

// --- Form rows -------------------------------------------------------------------

type ShiftRow = { key: number; starts: string; ends: string; cooks: string };
type MaterialRow = { key: number; item: string; quantity: string; unitPrice: string; amount: string };
type BatchRow = { key: number; product: string; patils: string; jarsPerPatil: string };
type MiscRow = { key: number; purpose: string; amount: string; note: string };

let nextKey = 1;
const key = () => nextKey++;

const digits = (s: string) => s.replace(/[^\d]/g, "");
/** A quantity: digits and at most one decimal point, three places. */
function decimal(s: string): string {
  const [whole, ...rest] = s.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 3)}` : whole;
}
const int = (s: string) => (s === "" ? 0 : Number(s));
const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

const emptyMaterial = (): MaterialRow => ({
  key: key(),
  item: "",
  quantity: "",
  unitPrice: "",
  amount: "",
});
const emptyBatch = (): BatchRow => ({ key: key(), product: "", patils: "1", jarsPerPatil: "" });
const emptyMisc = (): MiscRow => ({ key: key(), purpose: "", amount: "", note: "" });

/** What a bazar line comes to, as the server will work it out: quantity ×
 *  unit price rounded half up, or the lump sum. null while incomplete. */
function lineTotal(m: MaterialRow): number | null {
  if (m.quantity !== "" && m.unitPrice !== "") {
    const v = Number(m.quantity) * Number(m.unitPrice);
    return Number.isFinite(v) ? Math.round(v) : null;
  }
  return m.amount !== "" ? Number(m.amount) : null;
}

const isBlankMaterial = (m: MaterialRow) =>
  !m.item && !m.quantity && !m.unitPrice && !m.amount;
const isBlankMisc = (m: MiscRow) => !m.purpose.trim() && !m.amount && !m.note.trim();

const NEW = "__new";

// --- The sheet -------------------------------------------------------------------

/**
 * Making a day a production day, or correcting one. Wide, on the right, over
 * the page, in numbered cards. When the day is new, the time, shifts, team
 * and products of the latest production day are filled in (`template`), and
 * its bazar list is one click away. Raw materials and products are picked
 * from the store's own lists, managed from here. Every figure shown is a
 * preview; the server works out what is saved.
 */
export function ProductionSheet({
  day,
  editing,
  template,
  products,
  items,
  suggestions,
  onProducts,
  onItems,
  onClose,
  onSaved,
  onDeleted,
}: {
  day: string;
  /** The day as saved, when correcting it. */
  editing: ProductionDay | null;
  /** The latest production day, to start a new one from. */
  template: ProductionDay | null;
  products: ProductionProduct[];
  items: ProductionItem[];
  suggestions: ProductionSuggestions;
  onProducts: (p: ProductionProduct[]) => void;
  onItems: (i: ProductionItem[]) => void;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const start = editing ?? template;
  const [startsAt, setStartsAt] = React.useState(hm(start?.starts_at));
  const [endsAt, setEndsAt] = React.useState(hm(start?.ends_at));
  const [shifts, setShifts] = React.useState<ShiftRow[]>(
    () =>
      start?.shifts.map((s) => ({
        key: key(),
        starts: hm(s.starts),
        ends: hm(s.ends),
        cooks: s.cooks === null ? "" : String(s.cooks),
      })) ?? []
  );
  const [maleCooks, setMaleCooks] = React.useState(String(start?.male_cooks ?? ""));
  const [maleRate, setMaleRate] = React.useState(String(start?.male_rate ?? ""));
  const [femaleCooks, setFemaleCooks] = React.useState(String(start?.female_cooks ?? ""));
  const [femaleRate, setFemaleRate] = React.useState(String(start?.female_rate ?? ""));
  const [gas, setGas] = React.useState(editing ? String(editing.gas_cost) : "");
  const [packaging, setPackaging] = React.useState(editing ? String(editing.packaging_cost) : "");
  const [materials, setMaterials] = React.useState<MaterialRow[]>(() =>
    editing?.materials.length
      ? editing.materials.map((m) => ({
          key: key(),
          item: m.item,
          quantity: m.quantity === null ? "" : String(m.quantity),
          unitPrice: m.unit_price === null ? "" : String(m.unit_price),
          amount: m.quantity === null || m.unit_price === null ? String(m.amount) : "",
        }))
      : [emptyMaterial()]
  );
  const [batches, setBatches] = React.useState<BatchRow[]>(() =>
    start?.batches.length
      ? start.batches.map((b) => ({
          key: key(),
          product: b.product,
          patils: String(b.patils),
          jarsPerPatil: String(b.jars_per_patil),
        }))
      : [emptyBatch()]
  );
  const [misc, setMisc] = React.useState<MiscRow[]>(() =>
    editing?.misc.map((m) => ({
      key: key(),
      purpose: m.purpose,
      amount: String(m.amount),
      note: m.note ?? "",
    })) ?? []
  );
  const [note, setNote] = React.useState(editing?.note ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  // Which list's manager is open, and the row waiting for what it adds.
  const [managing, setManaging] = React.useState<{ kind: "items" | "products"; row?: number } | null>(
    null
  );
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  // Offered in the dropdowns: the store's lists, plus anything this day
  // already has that was since removed (the server accepts those here).
  const savedUnits = React.useMemo(
    () => new Map((editing?.materials ?? []).map((m) => [m.item, m.unit])),
    [editing]
  );
  const itemOptions = React.useMemo(() => {
    const opts = items.map((i) => ({ name: i.name, unit: i.unit as string | null }));
    for (const [name, unit] of savedUnits)
      if (!opts.some((o) => o.name === name)) opts.push({ name, unit });
    return opts;
  }, [items, savedUnits]);
  const unitOf = (name: string) => itemOptions.find((o) => o.name === name)?.unit ?? null;
  const productOptions = React.useMemo(() => {
    const names = products.map((p) => p.name);
    for (const b of editing?.batches ?? []) if (!names.includes(b.product)) names.push(b.product);
    return names;
  }, [products, editing]);
  const iconOf = (name: string) => products.find((p) => p.name === name)?.icon;

  // --- Live preview of the figures ---
  const materialsCost = materials.reduce((s, m) => s + (lineTotal(m) ?? 0), 0);
  const labourCost = int(maleCooks) * int(maleRate) + int(femaleCooks) * int(femaleRate);
  const miscCost = misc.reduce((s, m) => s + int(m.amount), 0);
  const total = materialsCost + labourCost + int(gas) + int(packaging) + miscCost;
  const jars = batches.reduce((s, b) => s + int(b.patils) * int(b.jarsPerPatil), 0);

  // --- What is wrong, if anything ---
  const problems: string[] = [];
  const filledBatches = batches.filter((b) => b.product || b.jarsPerPatil);
  if (filledBatches.length === 0) problems.push("অন্তত একটি রান্না করা পণ্য যোগ করুন।");
  if (filledBatches.some((b) => !b.product || int(b.patils) < 1 || int(b.jarsPerPatil) < 1))
    problems.push("প্রতিটি পণ্যের পাতিল আর প্রতি পাতিলে জার দিন।");
  const filledMaterials = materials.filter((m) => !isBlankMaterial(m));
  if (filledMaterials.some((m) => !m.item)) problems.push("কাঁচামালের প্রতিটি লাইনে আইটেম বাছুন।");
  if (filledMaterials.some((m) => m.item && lineTotal(m) === null))
    problems.push("প্রতিটি কাঁচামালের পরিমাণ ও একক দাম দিন, নয়তো মোট টাকা লিখুন।");
  const filledMisc = misc.filter((m) => !isBlankMisc(m));
  if (filledMisc.some((m) => !m.purpose.trim() || int(m.amount) < 1))
    problems.push("প্রতিটি অন্যান্য খরচের কারণ ও টাকার পরিমাণ দিন।");
  if (shifts.some((s) => !s.starts || !s.ends)) problems.push("প্রতিটি শিফটের শুরু ও শেষের সময় দিন।");

  const save = async () => {
    if (saving) return;
    // Save stays clickable; what is missing is said once it is pressed,
    // and keeps up as it is filled in.
    setTried(true);
    setError(null);
    if (problems.length) return;
    setSaving(true);
    const input: ProductionDayInput = {
      starts_at: startsAt || null,
      ends_at: endsAt || null,
      shifts: shifts.map((s) => ({
        starts: s.starts,
        ends: s.ends,
        cooks: s.cooks === "" ? null : Number(s.cooks),
      })),
      male_cooks: int(maleCooks),
      male_rate: int(maleRate),
      female_cooks: int(femaleCooks),
      female_rate: int(femaleRate),
      gas_cost: int(gas),
      packaging_cost: int(packaging),
      materials: filledMaterials.map((m) => {
        const priced = m.quantity !== "" && m.unitPrice !== "";
        return {
          item: m.item,
          quantity: m.quantity || null,
          unit_price: m.unitPrice === "" ? null : Number(m.unitPrice),
          // The server works the amount out itself when the line is priced.
          amount: priced ? null : Number(m.amount),
        };
      }),
      batches: filledBatches.map((b) => ({
        product: b.product,
        patils: int(b.patils),
        jars_per_patil: int(b.jarsPerPatil),
      })),
      misc: filledMisc.map((m) => ({
        purpose: m.purpose.trim(),
        amount: int(m.amount),
        note: m.note.trim() || null,
      })),
      note: note.trim() || null,
    };
    try {
      await saveProductionDay(day, input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  };

  /** The template's bazar list: items, quantities and prices, to adjust. */
  const copyBazarList = () => {
    if (!template) return;
    setMaterials(
      template.materials.map((m) => ({
        key: key(),
        // Only items still on the list can be saved.
        item: items.some((i) => i.name === m.item) ? m.item : "",
        quantity: m.quantity === null ? "" : String(m.quantity),
        unitPrice: m.unit_price === null ? "" : String(m.unit_price),
        amount: m.quantity === null || m.unit_price === null ? String(m.amount) : "",
      }))
    );
  };

  const setMaterial = (k: number, patch: Partial<MaterialRow>) =>
    setMaterials((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const setBatch = (k: number, patch: Partial<BatchRow>) =>
    setBatches((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const setMiscRow = (k: number, patch: Partial<MiscRow>) =>
    setMisc((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const setShift = (k: number, patch: Partial<ShiftRow>) =>
    setShifts((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  const canCopy = !editing && template !== null && template.materials.length > 0;

  return (
    <Sheet open onOpenChange={(o) => !o && !saving && onClose()}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-lg font-semibold">
            {editing ? "Edit production day" : "Start production day"}
          </SheetTitle>
          <SheetDescription>
            এই দিনের রান্নার সব খরচ। সেভ করলে মোট হিসাব করা হবে।
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex flex-1 flex-col gap-4 overflow-y-auto bg-muted/40 p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {/* --- 1. Date and time --- */}
          <Step n={1} title="Date & time">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Date" className="col-span-2 sm:col-span-1">
                <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                  <CalendarDays className="size-4 text-muted-foreground" />
                  {dayLabel(day, { weekday: true })}
                </div>
              </Field>
              <Field label="Starts">
                <Input type="time" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </Field>
              <Field label="Ends">
                <Input type="time" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </Field>
            </div>
            {shifts.length > 0 && (
              <div className="grid gap-2">
                <RowHead cols="grid-cols-[4rem_1fr_1fr_5rem_2rem]" labels={["", "Starts", "Ends", "Cooks", ""]} />
                {shifts.map((s, i) => (
                  <div key={s.key} className="grid grid-cols-[4rem_1fr_1fr_5rem_2rem] items-center gap-2">
                    <span className="text-sm text-muted-foreground">Shift {i + 1}</span>
                    <Input
                      type="time"
                      aria-label={`Shift ${i + 1} starts`}
                      value={s.starts}
                      onChange={(e) => setShift(s.key, { starts: e.target.value })}
                    />
                    <Input
                      type="time"
                      aria-label={`Shift ${i + 1} ends`}
                      value={s.ends}
                      onChange={(e) => setShift(s.key, { ends: e.target.value })}
                    />
                    <Input
                      inputMode="numeric"
                      aria-label={`Shift ${i + 1} cooks`}
                      placeholder="0"
                      value={s.cooks}
                      onChange={(e) => setShift(s.key, { cooks: digits(e.target.value) })}
                      className="tabular-nums"
                    />
                    <RemoveButton
                      label={`Remove shift ${i + 1}`}
                      onClick={() => setShifts((rows) => rows.filter((r) => r.key !== s.key))}
                    />
                  </div>
                ))}
              </div>
            )}
            {shifts.length < 6 && (
              <AddButton
                onClick={() =>
                  setShifts((rows) => [...rows, { key: key(), starts: "", ends: "", cooks: "" }])
                }
              >
                Add shift
              </AddButton>
            )}
          </Step>

          {/* --- 2. The team and its pay --- */}
          <Step n={2} title="Workforce & pay" hint="প্রত্যেক রাঁধুনির এক দিনের মজুরি।">
            <div className="grid gap-2">
              <RowHead cols="grid-cols-[6.5rem_1fr_1fr_6rem]" labels={["", "Cooks", "Pay each (৳)", "Total"]} />
              {(
                [
                  ["Male", maleCooks, setMaleCooks, maleRate, setMaleRate],
                  ["Female", femaleCooks, setFemaleCooks, femaleRate, setFemaleRate],
                ] as const
              ).map(([label, cooks, setCooks, rate, setRate]) => (
                <div key={label} className="grid grid-cols-[6.5rem_1fr_1fr_6rem] items-center gap-2">
                  <span className="text-sm">{label} cooks</span>
                  <Input
                    inputMode="numeric"
                    aria-label={`${label} cooks`}
                    placeholder="0"
                    value={cooks}
                    onChange={(e) => setCooks(digits(e.target.value))}
                    className="tabular-nums"
                  />
                  <Input
                    inputMode="numeric"
                    aria-label={`${label} pay each`}
                    placeholder="0"
                    value={rate}
                    onChange={(e) => setRate(digits(e.target.value))}
                    className="tabular-nums"
                  />
                  <span className="text-right text-sm tabular-nums">
                    {taka(int(cooks) * int(rate))}
                  </span>
                </div>
              ))}
            </div>
            <Subtotal label={`Total labour · ${int(maleCooks) + int(femaleCooks)} cooks`}>
              {taka(labourCost)}
            </Subtotal>
          </Step>

          {/* --- 3. The bazar list --- */}
          <Step
            n={3}
            title="Raw materials"
            hint="আইটেম বাছুন, তারপর আজ কতটুকু কেনা হলো আর একক দাম কত। পরিমাণ ও দাম না থাকলে মোট টাকা লিখুন।"
            action={<LinkButton onClick={() => setManaging({ kind: "items" })}>Manage items</LinkButton>}
          >
            <div className="grid gap-3 sm:gap-2">
              <RowHead
                cols="grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_2rem]"
                labels={["Item", "Quantity", "Unit", "Unit price (৳)", "Total (৳)", ""]}
              />
              {materials.map((m, i) => {
                const priced = m.quantity !== "" && m.unitPrice !== "";
                const unit = m.item ? unitOf(m.item) : null;
                return (
                  <div key={m.key} className="flex items-start gap-2">
                    <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)]">
                      <Select
                        value={m.item}
                        onValueChange={(v) =>
                          v === NEW
                            ? setManaging({ kind: "items", row: m.key })
                            : setMaterial(m.key, { item: v })
                        }
                      >
                        <SelectTrigger
                          className="col-span-4 w-full sm:col-span-1"
                          aria-label={`Item ${i + 1}`}
                        >
                          <SelectValue placeholder="আইটেম বাছুন" />
                        </SelectTrigger>
                        <SelectContent>
                          {itemOptions.map((o) => (
                            <SelectItem key={o.name} value={o.name}>
                              {o.name}
                              {o.unit && (
                                <span className="text-xs text-muted-foreground">({unitLabel(o.unit)})</span>
                              )}
                            </SelectItem>
                          ))}
                          {itemOptions.length > 0 && <SelectSeparator />}
                          <SelectItem value={NEW} className="text-primary">
                            <Plus className="size-4" />
                            New item…
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        aria-label={`Item ${i + 1} quantity`}
                        placeholder="পরিমাণ"
                        value={m.quantity}
                        onChange={(e) => setMaterial(m.key, { quantity: decimal(e.target.value) })}
                        className="tabular-nums"
                      />
                      <div
                        aria-label={`Item ${i + 1} unit`}
                        className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground"
                      >
                        {unit ? unitLabel(unit) : "—"}
                      </div>
                      <Input
                        inputMode="numeric"
                        aria-label={`Item ${i + 1} unit price`}
                        placeholder={unit ? `প্রতি ${unitLabel(unit)}` : "দাম"}
                        value={m.unitPrice}
                        onChange={(e) => setMaterial(m.key, { unitPrice: digits(e.target.value) })}
                        className="tabular-nums"
                      />
                      <Input
                        inputMode="numeric"
                        aria-label={`Item ${i + 1} total`}
                        placeholder="মোট"
                        disabled={priced}
                        value={priced ? String(lineTotal(m) ?? "") : m.amount}
                        onChange={(e) => setMaterial(m.key, { amount: digits(e.target.value) })}
                        className="tabular-nums disabled:bg-muted/40 disabled:opacity-100"
                      />
                    </div>
                    <RemoveButton
                      label={`Remove item ${i + 1}`}
                      onClick={() =>
                        setMaterials((rows) =>
                          rows.length > 1 ? rows.filter((r) => r.key !== m.key) : [emptyMaterial()]
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AddButton onClick={() => setMaterials((rows) => [...rows, emptyMaterial()])}>
                Add item
              </AddButton>
              {canCopy && (
                <Button type="button" variant="ghost" size="sm" onClick={copyBazarList} className="gap-1.5">
                  <Copy className="size-4" />
                  Copy list from {dayLabel(template!.day, { year: false })}
                </Button>
              )}
            </div>
            <Subtotal label="Total raw materials">{taka(materialsCost)}</Subtotal>
          </Step>

          {/* --- 4. What was cooked --- */}
          <Step
            n={4}
            title="Products cooked"
            hint="জার = পাতিল × প্রতি পাতিলে জার।"
            action={
              <LinkButton onClick={() => setManaging({ kind: "products" })}>Manage products</LinkButton>
            }
          >
            <div className="grid gap-2">
              <RowHead
                cols="grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_2rem]"
                labels={["Product", "Patils", "Jars per patil", "Jars", ""]}
              />
              {batches.map((b, i) => (
                <div
                  key={b.key}
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_2rem] items-center gap-2"
                >
                  <Select
                    value={b.product}
                    onValueChange={(v) =>
                      v === NEW
                        ? setManaging({ kind: "products", row: b.key })
                        : setBatch(b.key, { product: v })
                    }
                  >
                    <SelectTrigger className="w-full" aria-label={`Product ${i + 1}`}>
                      <SelectValue placeholder="পণ্য বাছুন" />
                    </SelectTrigger>
                    <SelectContent>
                      {productOptions.map((name) => (
                        <SelectItem key={name} value={name}>
                          <ProductIcon icon={iconOf(name)} className="size-4 text-muted-foreground" />
                          {name}
                        </SelectItem>
                      ))}
                      {productOptions.length > 0 && <SelectSeparator />}
                      <SelectItem value={NEW} className="text-primary">
                        <Plus className="size-4" />
                        New product…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="numeric"
                    aria-label={`Product ${i + 1} patils`}
                    placeholder="0"
                    value={b.patils}
                    onChange={(e) => setBatch(b.key, { patils: digits(e.target.value) })}
                    className="tabular-nums"
                  />
                  <Input
                    inputMode="numeric"
                    aria-label={`Product ${i + 1} jars per patil`}
                    placeholder="0"
                    value={b.jarsPerPatil}
                    onChange={(e) => setBatch(b.key, { jarsPerPatil: digits(e.target.value) })}
                    className="tabular-nums"
                  />
                  <span className="text-right text-sm tabular-nums">
                    {(int(b.patils) * int(b.jarsPerPatil)).toLocaleString("en-IN")}
                  </span>
                  <RemoveButton
                    label={`Remove product ${i + 1}`}
                    onClick={() =>
                      setBatches((rows) =>
                        rows.length > 1 ? rows.filter((r) => r.key !== b.key) : [emptyBatch()]
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <AddButton onClick={() => setBatches((rows) => [...rows, emptyBatch()])}>
              Add product
            </AddButton>
            <Subtotal label="Total jars produced">{jars.toLocaleString("en-IN")}</Subtotal>
          </Step>

          {/* --- 5. Everything else --- */}
          <Step n={5} title="Other costs">
            <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
              <Field label="Gas / fuel (৳)">
                <Input
                  inputMode="numeric"
                  placeholder="0"
                  value={gas}
                  onChange={(e) => setGas(digits(e.target.value))}
                  className="tabular-nums"
                />
              </Field>
              <Field label="Packaging (৳)">
                <Input
                  inputMode="numeric"
                  placeholder="0"
                  value={packaging}
                  onChange={(e) => setPackaging(digits(e.target.value))}
                  className="tabular-nums"
                />
              </Field>
            </div>
            <datalist id="prod-purposes">
              {suggestions.purposes.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            {misc.length > 0 && (
              <div className="grid gap-2">
                <RowHead
                  cols="grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,2fr)_2rem]"
                  labels={["Miscellaneous", "Amount (৳)", "Note", ""]}
                />
                {misc.map((m, i) => (
                  <div
                    key={m.key}
                    className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,2fr)_2rem] items-center gap-2"
                  >
                    <Input
                      list="prod-purposes"
                      aria-label={`Miscellaneous cost ${i + 1} purpose`}
                      placeholder="কারণ"
                      maxLength={80}
                      value={m.purpose}
                      onChange={(e) => setMiscRow(m.key, { purpose: e.target.value })}
                    />
                    <Input
                      inputMode="numeric"
                      aria-label={`Miscellaneous cost ${i + 1} amount`}
                      placeholder="0"
                      value={m.amount}
                      onChange={(e) => setMiscRow(m.key, { amount: digits(e.target.value) })}
                      className="tabular-nums"
                    />
                    <Input
                      aria-label={`Miscellaneous cost ${i + 1} note`}
                      placeholder="ঐচ্ছিক"
                      maxLength={300}
                      value={m.note}
                      onChange={(e) => setMiscRow(m.key, { note: e.target.value })}
                    />
                    <RemoveButton
                      label={`Remove miscellaneous cost ${i + 1}`}
                      onClick={() => setMisc((rows) => rows.filter((r) => r.key !== m.key))}
                    />
                  </div>
                ))}
              </div>
            )}
            <AddButton onClick={() => setMisc((rows) => [...rows, emptyMisc()])}>
              Add miscellaneous cost
            </AddButton>
          </Step>

          {/* --- 6. Where the money goes --- */}
          <Step n={6} title="Total cost breakdown" hint="লেখার সাথে সাথে হিসাব বদলায়; সেভ করার সময় আবার হিসাব করা হয়।">
            <CostBreakdown
              parts={[
                { label: "Raw materials (bazar)", amount: materialsCost, Icon: ShoppingBasket },
                { label: "Labour (male + female)", amount: labourCost, Icon: Users },
                { label: "Gas / fuel", amount: int(gas), Icon: Flame },
                { label: "Packaging", amount: int(packaging), Icon: Package },
                { label: "Miscellaneous", amount: miscCost, Icon: Shapes },
              ]}
              total={total}
              jars={jars}
            />
          </Step>

          {/* --- 7. A note --- */}
          <Step n={7} title="Note" hint="ঐচ্ছিক।">
            <Textarea
              aria-label="Note"
              placeholder="এই দিনের মনে রাখার মতো কিছু থাকলে লিখুন"
              value={note}
              maxLength={1000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </Step>
        </form>

        {/* --- The buttons (the totals are in card 6) --- */}
        <div
          className="border-t px-5 pt-4"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {(error || (tried && problems.length > 0)) && (
            <p className="mb-3 text-sm text-destructive">{error ?? problems[0]}</p>
          )}
          <div className="flex items-center gap-2">
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
              >
                <Trash2 className="size-4" />
                <span className="hidden sm:inline">Remove</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              onClick={onClose}
              disabled={saving}
              className="ml-auto"
            >
              Cancel
            </Button>
            <Button size="lg" onClick={save} disabled={saving} className="min-w-44 px-6 text-base">
              {saving ? "Saving…" : editing ? "Save changes" : "Save production day"}
            </Button>
          </div>
        </div>

        <ListManager
          kind="items"
          open={managing?.kind === "items"}
          onOpenChange={(o) => !o && setManaging(null)}
          rows={items}
          onChanged={(list) => onItems(list as ProductionItem[])}
          onAdded={(name) => {
            const row = managing?.row;
            setMaterials((rows) => {
              // Into the row that asked for it, else the first empty one.
              const i = row !== undefined ? rows.findIndex((r) => r.key === row) : rows.findIndex((r) => !r.item);
              return i < 0 ? rows : rows.map((r, j) => (j === i ? { ...r, item: name } : r));
            });
            setManaging(null);
          }}
          onRenamed={(from, to) =>
            setMaterials((rows) => rows.map((r) => (r.item === from ? { ...r, item: to } : r)))
          }
          onRemoved={(name) =>
            // A removed item stays only if this day already had it.
            !savedUnits.has(name) &&
            setMaterials((rows) => rows.map((r) => (r.item === name ? { ...r, item: "" } : r)))
          }
        />
        <ListManager
          kind="products"
          open={managing?.kind === "products"}
          onOpenChange={(o) => !o && setManaging(null)}
          rows={products}
          onChanged={(list) => onProducts(list as ProductionProduct[])}
          onAdded={(name) => {
            const row = managing?.row;
            setBatches((rows) => {
              const i = row !== undefined ? rows.findIndex((r) => r.key === row) : rows.findIndex((r) => !r.product);
              return i < 0 ? rows : rows.map((r, j) => (j === i ? { ...r, product: name } : r));
            });
            setManaging(null);
          }}
          onRenamed={(from, to) =>
            setBatches((rows) => rows.map((r) => (r.product === from ? { ...r, product: to } : r)))
          }
          onRemoved={(name) =>
            !editing?.batches.some((b) => b.product === name) &&
            setBatches((rows) => rows.map((r) => (r.product === name ? { ...r, product: "" } : r)))
          }
        />
        <RemoveDayDialog
          day={confirmingDelete ? day : null}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={onDeleted}
        />
      </SheetContent>
    </Sheet>
  );
}

// --- Bits ------------------------------------------------------------------------

/** One numbered part of the form, in its own card. */
function Step({
  n,
  title,
  hint,
  action,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // shrink-0: in the scrolling column a Card (overflow-hidden) would
    // otherwise shrink to fit and clip its own bottom.
    <Card className="shrink-0 gap-0 py-4 shadow-none">
      <CardContent className="grid gap-4 px-4">
        <div className="flex items-start gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {n}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              {action}
            </div>
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** Each part of the day's cost with its share, then the total. */
function CostBreakdown({
  parts,
  total,
  jars,
}: {
  parts: { label: string; amount: number; Icon: LucideIcon }[];
  total: number;
  jars: number;
}) {
  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-lg border">
        {parts.map(({ label, amount, Icon }) => {
          const share = total ? (amount / total) * 100 : 0;
          return (
            <li key={label} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{taka(amount)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                    {total ? `${share.toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between rounded-lg bg-primary px-4 py-3 text-primary-foreground">
        <div>
          <div className="text-xs opacity-80">Total production cost</div>
          <div className="text-xl font-semibold tabular-nums">{taka(total)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs opacity-80">Cost per jar</div>
          <div className="text-base font-semibold tabular-nums">
            {jars ? takaPaisa(total / jars) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Subtotal({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-primary/5 px-3 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className="font-semibold tabular-nums">{children}</span>
    </div>
  );
}

/** Column heads for a row grid; hidden on phones, where rows stack. */
function RowHead({ cols, labels }: { cols: string; labels: string[] }) {
  return (
    <div className={cn("hidden gap-2 text-xs text-muted-foreground sm:grid", cols)}>
      {labels.map((l, i) => (
        <span key={i} className="truncate">
          {l}
        </span>
      ))}
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-xs font-medium text-primary hover:underline"
    >
      {children}
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="w-fit gap-1.5">
      <Plus className="size-4" />
      {children}
    </Button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
    >
      <X className="size-4" />
    </button>
  );
}

type ListRow = { id: number; name: string; unit?: string; icon?: string };

const LIST_COPY = {
  items: {
    title: "Raw material items",
    description:
      "এই স্টোর রান্নার জন্য যা কেনে, প্রতিটি তার একক সহ। এখানে দাম নেই: প্রতিদিন সেদিনের দাম লেখা হয়। আইটেম বদলালে বা মুছলে আগে সেভ করা দিনের হিসাব বদলায় না।",
    singular: "item",
    taken: "এই আইটেমটি আগে থেকেই তালিকায় আছে।",
    placeholder: "যেমন: সরিষার তেল",
  },
  products: {
    title: "Products",
    description:
      "এই স্টোর যা রান্না করে। পণ্য বদলালে বা মুছলে আগে সেভ করা দিনের হিসাব বদলায় না।",
    singular: "product",
    taken: "এই পণ্যটি আগে থেকেই তালিকায় আছে।",
    placeholder: "যেমন: পদ্মার ইলিশ আচার",
  },
} as const;

/**
 * The store's raw-material items or its products: every one on the list,
 * each editable and deletable, and a form to add another. An item has a
 * unit; a product has an icon.
 */
function ListManager({
  kind,
  open,
  onOpenChange,
  rows,
  onChanged,
  onAdded,
  onRenamed,
  onRemoved,
}: {
  kind: "items" | "products";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ListRow[];
  onChanged: (list: ListRow[]) => void;
  onAdded: (name: string) => void;
  onRenamed: (from: string, to: string) => void;
  onRemoved: (name: string) => void;
}) {
  const copy = LIST_COPY[kind];
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [name, setName] = React.useState("");
  const [unit, setUnit] = React.useState<ProductionUnit>("kg");
  const [icon, setIcon] = React.useState("cooking-pot");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<number | null>(null);

  const reset = () => {
    setEditingId(null);
    setName("");
    setUnit("kg");
    setIcon("cooking-pot");
    setError(null);
    setConfirming(null);
  };
  // A fresh form each time it opens.
  React.useEffect(() => {
    if (open) {
      setEditingId(null);
      setName("");
      setUnit("kg");
      setIcon("cooking-pot");
      setError(null);
      setConfirming(null);
    }
  }, [open]);

  const clean = name.trim().replace(/\s+/g, " ");
  const taken = rows.some(
    (r) => r.id !== editingId && r.name.toLowerCase() === clean.toLowerCase()
  );
  const editingRow = rows.find((r) => r.id === editingId) ?? null;

  const submit = async () => {
    if (!clean || taken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = editingId ?? undefined;
      const list =
        kind === "items"
          ? await saveProductionItem({ name: clean, unit }, id)
          : await saveProductionProduct({ name: clean, icon }, id);
      onChanged(list);
      if (editingRow) {
        if (editingRow.name !== clean) onRenamed(editingRow.name, clean);
        reset();
      } else {
        onAdded(clean);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: ListRow) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(
        kind === "items" ? await deleteProductionItem(r.id) : await deleteProductionProduct(r.id)
      );
      onRemoved(r.name);
      if (editingId === r.id) reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex flex-1 flex-col gap-5 overflow-y-auto px-6">
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              On the list · {rows.length}
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">এখনো কিছু নেই। নিচে প্রথমটি যোগ করুন।</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm",
                      editingId === r.id && "border-primary bg-primary/5"
                    )}
                  >
                    {kind === "products" && (
                      <ProductIcon icon={r.icon} className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={r.name}>
                      {r.name}
                    </span>
                    {kind === "items" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {unitLabel(r.unit)}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Edit ${r.name}`}
                      title="Edit"
                      onClick={() => {
                        setEditingId(r.id);
                        setName(r.name);
                        if (r.unit) setUnit(r.unit as ProductionUnit);
                        if (r.icon) setIcon(r.icon);
                        setError(null);
                      }}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {confirming === r.id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        className="h-6 px-2 text-xs"
                        onClick={() => remove(r)}
                        onBlur={() => setConfirming(null)}
                        autoFocus
                      >
                        Delete
                      </Button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${r.name}`}
                        title="Delete"
                        onClick={() => setConfirming(r.id)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {editingRow ? `Edit ${editingRow.name}` : `Add ${copy.singular === "item" ? "an" : "a"} ${copy.singular}`}
              </h3>
              {editingRow && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs font-medium text-muted-foreground hover:underline"
                >
                  Cancel edit
                </button>
              )}
            </div>
            <div className={cn("grid gap-3", kind === "items" && "grid-cols-[1fr_7rem]")}>
              <div className="grid gap-1.5">
                <Label htmlFor={`${kind}-name`}>Name</Label>
                <div className="flex items-center gap-2">
                  {kind === "products" && (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
                      <ProductIcon icon={icon} className="size-4" />
                    </span>
                  )}
                  <Input
                    id={`${kind}-name`}
                    autoFocus
                    value={name}
                    maxLength={kind === "items" ? 120 : 80}
                    placeholder={copy.placeholder}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submit();
                      }
                    }}
                  />
                </div>
              </div>
              {kind === "items" && (
                <div className="grid gap-1.5">
                  <Label>Unit</Label>
                  <Select value={unit} onValueChange={(v) => setUnit(v as ProductionUnit)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCTION_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {taken && (
              <p className="text-xs text-destructive">{copy.taken}</p>
            )}
            {kind === "products" && (
              <div className="grid gap-1.5">
                <Label>Icon</Label>
                <div role="radiogroup" aria-label="Icon" className="grid grid-cols-10 gap-1.5">
                  {PRODUCT_ICONS.map(({ key: k, label, Icon }) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={icon === k}
                      aria-label={label}
                      title={label}
                      onClick={() => setIcon(k)}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border bg-background transition-colors hover:bg-accent",
                        icon === k && "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={submit} disabled={!clean || taken || busy}>
            {busy ? "Saving…" : editingRow ? "Save changes" : `Add ${copy.singular}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDayDialog({
  day,
  onClose,
  onDeleted,
}: {
  day: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog
      open={day !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove this production day?</DialogTitle>
          <DialogDescription>
            {day && dayLabel(day, { weekday: true })} আবার সাধারণ দিন হয়ে যাবে, আর এই দিনের
            সব তথ্য — কাঁচামাল, রাঁধুনি, পণ্য, খরচ — মুছে যাবে। এটা আর ফেরানো যাবে না।
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!day) return;
              setBusy(true);
              try {
                await deleteProductionDay(day);
                onDeleted();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not remove");
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
