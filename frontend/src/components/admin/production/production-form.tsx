"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChefHat,
  Clock3,
  Coins,
  Copy,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  User,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  deleteProductionDay,
  deleteProductionItem,
  deleteProductionProduct,
  getProductionDay,
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
import {
  costParts,
  KpiRow,
  ProductionHeader,
  SummaryRail,
  TotalBar,
  TotalCostBlock,
} from "./day-dashboard";
import { dayLabel, dhakaToday, taka, takaPaisa } from "./format";
import { PRODUCT_ICONS, ProductIcon } from "./product-icons";
import { useLeaveGuard } from "./use-leave-guard";

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

type FormProps = {
  /** The production as saved, when correcting it. */
  editing: ProductionDay | null;
  /** The latest production, whose bazar list a new one may copy. */
  template: ProductionDay | null;
  products: ProductionProduct[];
  items: ProductionItem[];
  suggestions: ProductionSuggestions;
  onProducts: (p: ProductionProduct[]) => void;
  onItems: (i: ProductionItem[]) => void;
};

/**
 * Adding a production, or correcting one, as a page of numbered cards laid
 * out like the dashboard it becomes. The date is today; a super admin may
 * pick an earlier one (or move a saved production). A new production starts
 * empty, whatever date is picked; the latest one's bazar list is one click
 * away. Every figure shown is a preview: the server works out what is saved.
 * Saving goes back to the list.
 */
export function ProductionForm(props: FormProps) {
  // Reset starts the form over from what it opened with.
  const [round, setRound] = React.useState(0);
  return <FormBody key={round} {...props} onReset={() => setRound((r) => r + 1)} />;
}

function FormBody({
  editing,
  template,
  products,
  items,
  suggestions,
  onProducts,
  onItems,
  onReset,
}: FormProps & { onReset: () => void }) {
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const today = dhakaToday();
  // Only a production being corrected fills the form; a new one is empty.
  const start = editing;

  const [day, setDay] = React.useState(editing?.day ?? today);
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

  // One production per date: is the picked date already taken (by another)?
  const [taken, setTaken] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (day === editing?.day) return;
    let cancelled = false;
    getProductionDay(day)
      .then((r) => !cancelled && setTaken(r ? day : null))
      .catch(() => !cancelled && setTaken(null));
    return () => {
      cancelled = true;
    };
  }, [day, editing]);
  const dateTaken = taken === day && day !== editing?.day;

  // Offered in the dropdowns: the store's lists, plus anything this
  // production already has that was since removed (the server accepts those).
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
  if (dateTaken) problems.push("এই তারিখে আগেই একটি প্রোডাকশন আছে।");
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

  const backTo = editing ? `/admin/crm/production/${editing.day}` : "/admin/crm/production";

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
      await saveProductionDay(day, input, editing?.day);
      // Back to the list, on the saved production's month.
      router.push(`/admin/crm/production?month=${day.slice(0, 7)}&saved=${day}`);
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
  const canPickDate = isSuperAdmin;

  /** Shifts follow the "Total shift" picker: more adds empty ones, fewer
   *  drops the last. */
  const setShiftCount = (n: number) =>
    setShifts((rows) =>
      n <= rows.length
        ? rows.slice(0, n)
        : [
            ...rows,
            ...Array.from({ length: n - rows.length }, () => ({
              key: key(),
              starts: "",
              ends: "",
              cooks: "",
            })),
          ]
    );

  // The dashboard around the form shows what is being typed.
  const preview: ProductionDay = {
    day,
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
    note: note.trim() || null,
    materials: [],
    batches: filledBatches.map((b) => ({
      product: b.product || "—",
      patils: int(b.patils),
      jars_per_patil: int(b.jarsPerPatil),
      jars: int(b.patils) * int(b.jarsPerPatil),
    })),
    misc: [],
    materials_cost: materialsCost,
    labour_cost: labourCost,
    misc_cost: miscCost,
    total_cost: total,
    patils: batches.reduce((s, b) => s + int(b.patils), 0),
    jars,
    cost_per_jar: jars ? total / jars : 0,
    updated_at: "",
  };

  // Unsaved: anything differs from how the page opened. Saving or deleting
  // navigates with router.push, which the guard does not stop.
  const snapshot = JSON.stringify([
    day,
    startsAt,
    endsAt,
    shifts.map((s) => [s.starts, s.ends, s.cooks]),
    [maleCooks, maleRate, femaleCooks, femaleRate, gas, packaging, note],
    materials.map((m) => [m.item, m.quantity, m.unitPrice, m.amount]),
    batches.map((b) => [b.product, b.patils, b.jarsPerPatil]),
    misc.map((m) => [m.purpose, m.amount, m.note]),
  ]);
  const [opened] = React.useState(snapshot);
  useLeaveGuard(
    snapshot !== opened && !saving,
    "সেভ না করা তথ্য আছে। এই পাতা ছেড়ে গেলে লেখা তথ্য হারিয়ে যাবে। তবুও যাবেন?"
  );

  return (
    <div className="@container">
      <ProductionHeader
        title="Production"
        subtitle="প্রতিদিনের রান্না, কর্মী, কাঁচামাল আর মোট খরচের হিসাব।"
        day={day}
      />

      {/* The page reads as the dashboard it will become; only the form is
          lit, the rest follows it, dimmed. */}
      <div className="mt-6 grid items-start gap-4 @[88rem]:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="grid min-w-0 gap-4">
          <div aria-hidden className="pointer-events-none select-none opacity-40">
            <KpiRow record={preview} />
          </div>

          <form
            className="@container overflow-hidden rounded-2xl border bg-card shadow-2xl ring-4 ring-primary/15"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {/* --- The card's title bar --- */}
            <div className="flex items-start gap-3 bg-primary px-5 py-4 text-primary-foreground">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15">
                <ChefHat className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">
                  {editing ? "Update production costing" : "Add production costing"}
                </h2>
                <p className="text-sm opacity-90">
                  এই দিনের সব তথ্য লিখুন। সেভ করলে প্রোডাকশনের তালিকায় যোগ হবে।
                </p>
              </div>
              <Link
                href={backTo}
                aria-label="Close"
                className="rounded-md p-1.5 transition-colors hover:bg-primary-foreground/15"
              >
                <X className="size-5" />
              </Link>
            </div>

            <div className="grid gap-4 p-4 @2xl:grid-cols-12 @2xl:p-5">
              {/* --- 1. Date and time --- */}
              <Box n={1} title="Date & basic info" className="@2xl:col-span-6">
                <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                  <label className="grid gap-1.5">
                    <span className="text-xs text-muted-foreground">Date *</span>
                    {canPickDate ? (
                      <Input
                        type="date"
                        value={day}
                        max={today}
                        onChange={(e) => e.target.value && setDay(e.target.value)}
                      />
                    ) : (
                      <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                        <CalendarDays className="size-4 text-muted-foreground" />
                        {dayLabel(day)}
                      </div>
                    )}
                  </label>
                  <div className="grid gap-1.5">
                    <span className="text-xs text-muted-foreground">Production time</span>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="time"
                        aria-label="Production starts"
                        value={startsAt}
                        onChange={(e) => setStartsAt(e.target.value)}
                      />
                      <span className="text-muted-foreground">–</span>
                      <Input
                        type="time"
                        aria-label="Production ends"
                        value={endsAt}
                        onChange={(e) => setEndsAt(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {canPickDate
                    ? "তারিখ আজকের; আগের কোনো দিনের প্রোডাকশন লিখতে তারিখ বদলান।"
                    : "তারিখ নিজে থেকেই আজকের। শুধু সুপার অ্যাডমিন অন্য তারিখ দিতে পারেন।"}
                </p>
                {dateTaken && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                    {dayLabel(day)}-এ আগেই একটি প্রোডাকশন আছে।{" "}
                    <Link
                      href={`/admin/crm/production/${day}`}
                      className="font-medium text-primary hover:underline"
                    >
                      সেটি খুলুন →
                    </Link>
                  </div>
                )}
              </Box>

              {/* --- Shifts --- */}
              <Box icon={Clock3} title="Shift information" className="@2xl:col-span-6">
                <label className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Total shift</span>
                  <Select
                    value={String(shifts.length)}
                    onValueChange={(v) => setShiftCount(Number(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {/* One shift per row, going down: when, and how many cooks
                    worked it. For the record only; pay is cooks × rate. */}
                {shifts.length > 0 && (
                  <div className="overflow-hidden rounded-lg border">
                    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem] gap-2 bg-muted/50 px-3 py-2 text-[11px] font-medium">
                      <span>Shift</span>
                      <span>Starts</span>
                      <span>Ends</span>
                      <span>Cooks</span>
                    </div>
                    {shifts.map((s, i) => (
                      <div
                        key={s.key}
                        className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem] items-center gap-2 border-t px-3 py-1.5"
                      >
                        <span className="text-sm font-medium">{i + 1}</span>
                        <Input
                          type="time"
                          aria-label={`Shift ${i + 1} starts`}
                          value={s.starts}
                          onChange={(e) => setShift(s.key, { starts: e.target.value })}
                          className="h-8 px-2"
                        />
                        <Input
                          type="time"
                          aria-label={`Shift ${i + 1} ends`}
                          value={s.ends}
                          onChange={(e) => setShift(s.key, { ends: e.target.value })}
                          className="h-8 px-2"
                        />
                        <div className="relative">
                          <Input
                            inputMode="numeric"
                            aria-label={`Cooks in shift ${i + 1}`}
                            placeholder="0"
                            value={s.cooks}
                            onChange={(e) => setShift(s.key, { cooks: digits(e.target.value) })}
                            className="h-8 pr-7 pl-2 tabular-nums"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-muted-foreground">
                            জন
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  প্রতিটি শিফটে কতজন রাঁধুনি কাজ করেছেন, তা শুধু তথ্যের জন্য; মজুরি হিসাব হয়
                  Workforce × Cook salary থেকে।
                </p>
              </Box>

              {/* --- 2. The team --- */}
              <Box n={2} title="Workforce" aside="(Today)" className="@2xl:col-span-6">
                <div className="grid grid-cols-3 gap-2">
                  <Tally icon={User} label="Male cook" value={maleCooks} onChange={setMaleCooks} />
                  <Tally icon={UserRound} label="Female cook" value={femaleCooks} onChange={setFemaleCooks} />
                  <div className="flex flex-col items-center gap-1 rounded-lg bg-primary/10 p-2.5 text-center">
                    <span className="flex items-center gap-1 text-xs font-medium">
                      <Users className="size-4 text-primary" />
                      Total cook
                    </span>
                    <span className="flex h-9 items-center text-xl font-bold tabular-nums">
                      {int(maleCooks) + int(femaleCooks)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">জন</span>
                  </div>
                </div>
              </Box>

              {/* --- Their pay --- */}
              <Box icon={Coins} title="Cook salary" aside="(Today)" className="@2xl:col-span-6">
                <div className="grid gap-2">
                  {(
                    [
                      [User, "Male cook", maleCooks, maleRate, setMaleRate],
                      [UserRound, "Female cook", femaleCooks, femaleRate, setFemaleRate],
                    ] as const
                  ).map(([Icon, label, cooks, rate, setRate]) => (
                    <div
                      key={label}
                      className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem_auto_4.5rem] items-center gap-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon className="size-4 shrink-0 text-primary" />
                        <span className="truncate">{label}</span>
                      </span>
                      <span className="text-muted-foreground tabular-nums">{int(cooks)} × ৳</span>
                      <Input
                        inputMode="numeric"
                        aria-label={`${label} pay each`}
                        placeholder="0"
                        value={rate}
                        onChange={(e) => setRate(digits(e.target.value))}
                        className="h-8 tabular-nums"
                      />
                      <span className="text-muted-foreground">=</span>
                      <span className="text-right font-semibold tabular-nums">
                        {taka(int(cooks) * int(rate))}
                      </span>
                    </div>
                  ))}
                </div>
                <TotalBar className="mt-auto" label="Total labour cost">{taka(labourCost)}</TotalBar>
              </Box>

              {/* --- 3. The bazar list --- */}
              <Box
                n={3}
                title="Raw materials"
                aside="(Bazar list)"
                action={<LinkButton onClick={() => setManaging({ kind: "items" })}>Manage items</LinkButton>}
                className="@2xl:col-span-12 @4xl:col-span-5"
              >
                <div className="overflow-hidden rounded-lg border">
                  <div className="hidden grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_4.75rem_4.5rem_1.25rem] gap-1.5 bg-muted/50 px-2 py-2 text-[11px] font-medium @lg:grid">
                    <span>#</span>
                    <span>Item</span>
                    <span>Quantity</span>
                    <span>Unit price (৳)</span>
                    <span className="text-right">Total (৳)</span>
                    <span />
                  </div>
                  {materials.map((m, i) => {
                    const priced = m.quantity !== "" && m.unitPrice !== "";
                    const unit = m.item ? unitOf(m.item) : null;
                    return (
                      <div
                        key={m.key}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_1.25rem] items-center gap-1.5 border-t px-2 py-1.5 first:border-t-0 @lg:grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_4.75rem_4.5rem_1.25rem] @lg:first:border-t"
                      >
                        <span className="hidden text-xs text-muted-foreground tabular-nums @lg:block">
                          {i + 1}
                        </span>
                        <Select
                          value={m.item}
                          onValueChange={(v) =>
                            v === NEW
                              ? setManaging({ kind: "items", row: m.key })
                              : setMaterial(m.key, { item: v })
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="col-span-3 w-full @lg:col-span-1"
                            aria-label={`Item ${i + 1}`}
                          >
                            <SelectValue placeholder="আইটেম বাছুন" />
                          </SelectTrigger>
                          <SelectContent>
                            {itemOptions.map((o) => (
                              <SelectItem key={o.name} value={o.name}>
                                {o.name}
                                {o.unit && (
                                  <span className="text-xs text-muted-foreground">
                                    ({unitLabel(o.unit)})
                                  </span>
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
                        <RemoveButton
                          label={`Remove item ${i + 1}`}
                          onClick={() =>
                            setMaterials((rows) =>
                              rows.length > 1 ? rows.filter((r) => r.key !== m.key) : [emptyMaterial()]
                            )
                          }
                          className="@lg:order-1"
                        />
                        <div className="relative">
                          <Input
                            inputMode="decimal"
                            aria-label={`Item ${i + 1} quantity`}
                            placeholder="0"
                            value={m.quantity}
                            onChange={(e) => setMaterial(m.key, { quantity: decimal(e.target.value) })}
                            className={cn("h-8 px-2 tabular-nums", unit && "pr-11")}
                          />
                          {unit && (
                            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-muted-foreground">
                              {unitLabel(unit)}
                            </span>
                          )}
                        </div>
                        <Input
                          inputMode="numeric"
                          aria-label={`Item ${i + 1} unit price`}
                          placeholder="দাম"
                          value={m.unitPrice}
                          onChange={(e) => setMaterial(m.key, { unitPrice: digits(e.target.value) })}
                          className="h-8 px-2 tabular-nums"
                        />
                        <Input
                          inputMode="numeric"
                          aria-label={`Item ${i + 1} total`}
                          placeholder="মোট"
                          disabled={priced}
                          value={priced ? String(lineTotal(m) ?? "") : m.amount}
                          onChange={(e) => setMaterial(m.key, { amount: digits(e.target.value) })}
                          className="h-8 px-2 text-right tabular-nums disabled:border-transparent disabled:bg-transparent disabled:opacity-100"
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
                <TotalBar className="mt-auto" label="Total raw material cost">{taka(materialsCost)}</TotalBar>
              </Box>

              {/* --- 4. What was cooked --- */}
              <Box
                n={4}
                title="Cooking details"
                aside="(প্রতি পণ্যের জন্য)"
                action={
                  <LinkButton onClick={() => setManaging({ kind: "products" })}>Manage products</LinkButton>
                }
                className="@2xl:col-span-7 @4xl:col-span-4"
              >
                <div className="overflow-hidden rounded-lg border">
                  <div className="grid grid-cols-[minmax(0,1fr)_3.25rem_3.75rem_3.25rem_1.25rem] gap-1.5 bg-muted/50 px-2 py-2 text-[11px] font-medium leading-tight">
                    <span>Product</span>
                    <span className="text-center">No. of patil</span>
                    <span className="text-center">Per patil (jar)</span>
                    <span className="text-right">Total jar</span>
                    <span />
                  </div>
                  {batches.map((b, i) => (
                    <div
                      key={b.key}
                      className="grid grid-cols-[minmax(0,1fr)_3.25rem_3.75rem_3.25rem_1.25rem] items-center gap-1.5 border-t px-2 py-1.5"
                    >
                      <Select
                        value={b.product}
                        onValueChange={(v) =>
                          v === NEW
                            ? setManaging({ kind: "products", row: b.key })
                            : setBatch(b.key, { product: v })
                        }
                      >
                        <SelectTrigger size="sm" className="w-full" aria-label={`Product ${i + 1}`}>
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
                        className="h-8 px-2 text-center tabular-nums"
                      />
                      <Input
                        inputMode="numeric"
                        aria-label={`Product ${i + 1} jars per patil`}
                        placeholder="0"
                        value={b.jarsPerPatil}
                        onChange={(e) => setBatch(b.key, { jarsPerPatil: digits(e.target.value) })}
                        className="h-8 px-2 text-center tabular-nums"
                      />
                      <span className="text-right text-sm font-semibold tabular-nums">
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
                <TotalBar className="mt-auto" label="Total jar produced">{jars.toLocaleString("en-IN")}</TotalBar>
              </Box>

              {/* --- 5. Where the money goes --- */}
              <Box n={5} title="Total cost breakdown" className="@2xl:col-span-5 @4xl:col-span-3">
                <ul className="grid">
                  {costParts(preview).map(({ label, amount, Icon }) => (
                    <li key={label} className="flex items-center gap-2.5 border-b py-2 last:border-0">
                      <Icon className="size-4.5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] text-muted-foreground">{label}</div>
                        <div className="text-sm font-semibold tabular-nums">{taka(amount)}</div>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {total ? `${((amount / total) * 100).toFixed(1)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
                <TotalCostBlock total={total} className="mt-auto px-4 py-3" />
                <p className="text-center text-xs text-muted-foreground">
                  প্রতি জার: {jars ? takaPaisa(total / jars) : "—"}
                </p>
              </Box>

              {/* --- 6. Everything else --- */}
              <Box n={6} title="Miscellaneous" className="@2xl:col-span-12 @4xl:col-span-9">
                <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
                  <label className="grid gap-1.5">
                    <span className="text-xs text-muted-foreground">Gas / fuel (৳)</span>
                    <Input
                      inputMode="numeric"
                      placeholder="0"
                      value={gas}
                      onChange={(e) => setGas(digits(e.target.value))}
                      className="tabular-nums"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-muted-foreground">Packaging (৳)</span>
                    <Input
                      inputMode="numeric"
                      placeholder="0"
                      value={packaging}
                      onChange={(e) => setPackaging(digits(e.target.value))}
                      className="tabular-nums"
                    />
                  </label>
                </div>
                <datalist id="prod-purposes">
                  {suggestions.purposes.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                {misc.length > 0 && (
                  <div className="grid gap-2">
                    <div className="hidden grid-cols-[minmax(0,1fr)_6rem_minmax(0,1.4fr)_1.25rem] gap-2 text-xs text-muted-foreground @lg:grid">
                      <span>Other expenses</span>
                      <span>Amount (৳)</span>
                      <span>Note (optional)</span>
                      <span />
                    </div>
                    {misc.map((m, i) => (
                      <div
                        key={m.key}
                        className="grid grid-cols-[minmax(0,1fr)_6rem_1.25rem] items-center gap-2 @lg:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1.4fr)_1.25rem]"
                      >
                        <Input
                          list="prod-purposes"
                          aria-label={`Other expense ${i + 1} purpose`}
                          placeholder="কারণ"
                          maxLength={80}
                          value={m.purpose}
                          onChange={(e) => setMiscRow(m.key, { purpose: e.target.value })}
                        />
                        <Input
                          inputMode="numeric"
                          aria-label={`Other expense ${i + 1} amount`}
                          placeholder="0"
                          value={m.amount}
                          onChange={(e) => setMiscRow(m.key, { amount: digits(e.target.value) })}
                          className="tabular-nums"
                        />
                        <Input
                          aria-label={`Other expense ${i + 1} note`}
                          placeholder="ঐচ্ছিক"
                          maxLength={300}
                          value={m.note}
                          onChange={(e) => setMiscRow(m.key, { note: e.target.value })}
                          className="order-last col-span-2 @lg:order-none @lg:col-span-1"
                        />
                        <RemoveButton
                          label={`Remove other expense ${i + 1}`}
                          onClick={() => setMisc((rows) => rows.filter((r) => r.key !== m.key))}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <AddButton onClick={() => setMisc((rows) => [...rows, emptyMisc()])}>
                  Add other expense
                </AddButton>
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Note (optional)</span>
                  <Textarea
                    placeholder="এই দিনের মনে রাখার মতো কিছু থাকলে লিখুন"
                    value={note}
                    maxLength={1000}
                    rows={2}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </Box>

              {/* --- The buttons --- */}
              <div className="flex flex-col justify-end gap-2 @2xl:col-span-12 @4xl:col-span-3">
                {(error || (tried && problems.length > 0)) && (
                  <p className="text-sm text-destructive">{error ?? problems[0]}</p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {editing && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive @4xl:mr-0"
                      onClick={() => setConfirmingDelete(true)}
                      disabled={saving}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={onReset}
                    disabled={saving}
                    className="gap-1.5"
                  >
                    <RotateCcw className="size-4" />
                    Reset
                  </Button>
                  <Button type="submit" size="lg" disabled={saving} className="gap-1.5 px-5">
                    <Save className="size-4" />
                    {saving ? "Saving…" : editing ? "Save changes" : "Save & add"}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div aria-hidden className="pointer-events-none hidden select-none gap-4 opacity-40 @[88rem]:grid">
          <SummaryRail record={preview} />
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
          // A removed item stays only if this production already had it.
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
      <DeleteDialog
        day={confirmingDelete && editing ? editing.day : null}
        onClose={() => setConfirmingDelete(false)}
        onDeleted={() => router.push(`/admin/crm/production?month=${editing?.day.slice(0, 7)}`)}
      />
    </div>
  );
}

// --- Bits ------------------------------------------------------------------------

/** One part of the form card: a numbered (or iconed) heading, then its
 *  fields, in a light box like the dashboard card it fills. */
function Box({
  n,
  icon: Icon,
  title,
  aside,
  action,
  className,
  children,
}: {
  n?: number;
  icon?: LucideIcon;
  title: string;
  aside?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-xl border p-4", className)}>
      <div className="flex items-center gap-2">
        {n !== undefined ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {n}
          </span>
        ) : (
          Icon && <Icon className="size-5 shrink-0 text-primary" />
        )}
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <span className="truncate text-xs text-muted-foreground">{aside}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A head count with − and + either side of it. */
function Tally({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const n = int(value);
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-2.5 text-center">
      <span className="flex items-center gap-1 text-xs font-medium">
        <Icon className="size-4 text-primary" />
        {label}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`One fewer ${label.toLowerCase()}`}
          disabled={n <= 0}
          onClick={() => onChange(String(Math.max(0, n - 1)))}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background disabled:opacity-30"
        >
          <Minus className="size-3.5" />
        </button>
        <Input
          inputMode="numeric"
          aria-label={label}
          placeholder="0"
          value={value}
          onChange={(e) => onChange(digits(e.target.value))}
          className="h-9 w-12 px-1 text-center text-lg font-bold tabular-nums"
        />
        <button
          type="button"
          aria-label={`One more ${label.toLowerCase()}`}
          onClick={() => onChange(String(n + 1))}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <span className="text-[11px] text-muted-foreground">জন</span>
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

function RemoveButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        className
      )}
    >
      <X className="size-3.5" />
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

function DeleteDialog({
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
          <DialogTitle>Delete this production?</DialogTitle>
          <DialogDescription>
            {day && dayLabel(day, { weekday: true })}-এর প্রোডাকশন আর এর সব তথ্য — কাঁচামাল,
            রাঁধুনি, পণ্য, খরচ — মুছে যাবে। এটা আর ফেরানো যাবে না।
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
                setError(err instanceof Error ? err.message : "Could not delete");
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
