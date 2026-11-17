"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileDown,
  Loader2,
  Lock,
  LockOpen,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { dayLabel, dhakaToday, taka, takaPaisa } from "@/components/admin/production/format";
import {
  BASIS_LABELS,
  count,
  download,
  Figure,
  num,
  rate,
  ReceivedBar,
  slotLineAmount,
  StatusBadge,
} from "@/components/admin/production/batch/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  closeProductionRun,
  deleteProductionRun,
  deleteProductionSlot,
  getProductionRun,
  getProductionRunDefaults,
  getProductionSlotInvoice,
  reopenProductionRun,
  saveProductionSlot,
  unitLabel,
  type ProductionRun,
  type ProductionSlot,
  type SlotCost,
  type SlotCostBasis,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const fail = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** How a slot cost was worked out, as the invoice says it. */
function how(c: SlotCost, packets: number, pieces: number): string {
  if (c.basis === "per_1000_pieces") return `${count(pieces)} pieces × ${rate(c.rate)} per 1,000`;
  if (c.basis === "per_packet") return `${count(packets)} packets × ${rate(c.rate)}`;
  return "Fixed amount";
}

/**
 * One batch production: received against ordered, what was bought up front,
 * every slot with its invoice, and closing. Anyone on Production receives
 * slots and fills in the order while it is open; production admins delete
 * slots; CRM admins delete the production; a super admin closes early and
 * reopens.
 */
export function RunView({ id }: { id: number }) {
  const router = useRouter();
  const { can, isSuperAdmin } = useAuth();
  const [run, setRun] = React.useState<ProductionRun | null>(null);
  const [slotCosts, setSlotCosts] = React.useState<SlotCost[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([getProductionRun(id), getProductionRunDefaults()])
      .then(([r, d]) => {
        if (cancelled) return;
        setRun(r);
        setSlotCosts(d.slotCosts);
      })
      .catch((err) => !cancelled && setError(fail(err, "Failed to load")));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The slot drawer: undefined closed, null a new slot, or the slot to edit.
  const [editing, setEditing] = React.useState<ProductionSlot | null | undefined>(undefined);
  const [closing, setClosing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [slotToDelete, setSlotToDelete] = React.useState<ProductionSlot | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const listHref = run ? `/admin/crm/production?month=${run.openedOn.slice(0, 7)}` : "/admin/crm/production";

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!run) return <Skeleton className="h-96 w-full" />;

  const open = !run.closed;
  const invoice = async (s: ProductionSlot) => {
    setBusy(`invoice-${s.id}`);
    setActionError(null);
    try {
      download(await getProductionSlotInvoice(run.id, s.id), `production-${run.id}-slot-${s.number}.pdf`);
    } catch (err) {
      setActionError(fail(err, "Could not make the invoice"));
    } finally {
      setBusy(null);
    }
  };
  const reopen = async () => {
    setBusy("reopen");
    setActionError(null);
    try {
      setRun(await reopenProductionRun(run.id));
    } catch (err) {
      setActionError(fail(err, "Could not reopen"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="@container">
      <Link
        href={listHref}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to productions
      </Link>

      {/* --- Header --- */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{run.name}</h1>
            <StatusBadge closed={run.closed} closedEarly={run.closedEarly} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Opened {dayLabel(run.openedOn, { weekday: true })}
            {run.closedAt && ` · closed ${new Date(run.closedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => router.push(`/admin/crm/production/runs/${run.id}/edit`)}
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
          {open && run.pending > 0 && isSuperAdmin && (
            <Button
              variant="outline"
              className="gap-1.5 text-amber-700 hover:text-amber-800 dark:text-amber-400"
              onClick={() => setClosing(true)}
            >
              <Lock className="size-4" />
              Close early
            </Button>
          )}
          {!open && isSuperAdmin && (
            <Button variant="outline" className="gap-1.5" disabled={busy === "reopen"} onClick={reopen}>
              {busy === "reopen" ? <Loader2 className="size-4 animate-spin" /> : <LockOpen className="size-4" />}
              Reopen
            </Button>
          )}
          {can("crm.admin") && (
            <Button
              variant="outline"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}
        </div>
      </div>
      {actionError && <p className="mt-2 text-sm text-destructive">{actionError}</p>}

      {/* --- Received / pending --- */}
      <Card className="mt-5 gap-0 py-5">
        <CardContent className="grid gap-4 px-5">
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat label="Ordered" value={count(run.units)} note="packets" />
            <Stat
              label="Received"
              value={count(run.received)}
              note={`${count(run.piecesReceived)} pieces`}
              tone="good"
            />
            <Stat
              label="Pending"
              value={count(run.pending)}
              note={run.pending ? "packets" : "all received"}
              tone={run.pending ? "warn" : "good"}
            />
          </div>
          <ReceivedBar received={run.received} units={run.units} />
        </CardContent>
      </Card>

      {open && run.pending === 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Every packet is received. Record the raw material used and close the production.
          </p>
          <Button className="gap-1.5" onClick={() => setClosing(true)}>
            <Lock className="size-4" />
            Close production
          </Button>
        </div>
      )}

      {/* --- Figures --- */}
      <div className="mt-4 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <Figure label="Bought up front" value={taka(run.materialsCost)} />
        <Figure label="Slot costs" value={taka(run.slotsCost)} note={`${run.slots} ${run.slots === 1 ? "slot" : "slots"}`} />
        <Figure label="Total cost" value={taka(run.totalCost)} />
        <Figure
          label={run.closed ? "Cost per packet" : "Cost per packet so far"}
          value={run.costPerPacket === null ? "—" : takaPaisa(run.costPerPacket)}
          note={run.costPerPiece === null ? undefined : `${takaPaisa(run.costPerPiece)} per piece`}
          emphasis
        />
      </div>

      <div className="mt-4 grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* --- Bought up front --- */}
        <Card className="gap-3 self-start">
          <CardHeader>
            <CardTitle>Bought for this order</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-0 text-sm">
            <Line
              label="Raw material"
              detail={[
                run.rawKg !== null ? `${run.rawKg} kg bought` : null,
                run.rawUsedKg !== null ? `${run.rawUsedKg} kg used` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              amount={run.rawCost}
            />
            {run.costs.map((c, i) => (
              <Line
                key={i}
                label={c.item}
                detail={
                  c.quantity === null
                    ? `Quantity not filled in · ${rate(c.unitPrice)} each`
                    : `${count(c.quantity)} ${unitLabel(c.unit)} × ${rate(c.unitPrice)}`
                }
                amount={c.amount}
                muted={c.quantity === null}
              />
            ))}
            <div className="flex justify-between border-t pt-3 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{taka(run.materialsCost)}</span>
            </div>
            {run.note && <p className="mt-3 text-xs whitespace-pre-line text-muted-foreground">{run.note}</p>}
          </CardContent>
        </Card>

        {/* --- Slots --- */}
        <section className="grid content-start gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Slots received</h2>
            {open && run.pending > 0 && (
              <Button className="gap-1.5" onClick={() => setEditing(null)}>
                <PackagePlus className="size-4" />
                Receive slot
              </Button>
            )}
          </div>
          {run.slotList.length === 0 ? (
            <Card className="py-8">
              <CardContent className="text-center text-sm text-muted-foreground">
                No slot received yet. When finished packets arrive, press &ldquo;Receive slot&rdquo;.
              </CardContent>
            </Card>
          ) : (
            run.slotList.map((s) => (
              <Card key={s.id} className="gap-3 py-4">
                <CardContent className="grid gap-3 px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        Slot {s.number}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {dayLabel(s.receivedOn, { weekday: true })}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {count(s.packets)} packets · {count(s.pieces)} pieces
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy === `invoice-${s.id}`}
                        onClick={() => invoice(s)}
                      >
                        {busy === `invoice-${s.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <FileDown className="size-3.5" />
                        )}
                        Invoice
                      </Button>
                      {open && (
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(s)}>
                          <Pencil className="size-3.5" />
                          Edit
                        </Button>
                      )}
                      {open && can("production.admin") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete slot ${s.number}`}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setSlotToDelete(s)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-1 text-sm">
                    {s.costs.map((c, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          {c.label}
                          <span className="ml-2 text-xs text-muted-foreground">{how(c, s.packets, s.pieces)}</span>
                        </span>
                        <span className="tabular-nums">{taka(c.amount)}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex justify-between border-t pt-2 font-semibold">
                      <span>Total payable</span>
                      <span className="tabular-nums">{taka(s.totalCost)}</span>
                    </div>
                  </div>
                  {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                </CardContent>
              </Card>
            ))
          )}
        </section>
      </div>

      {editing !== undefined && (
        <SlotSheet
          run={run}
          slot={editing}
          startCosts={slotCosts}
          onClose={() => setEditing(undefined)}
          onSaved={(r) => {
            setRun(r);
            setEditing(undefined);
          }}
        />
      )}
      <CloseDialog
        run={run}
        open={closing}
        onOpenChange={setClosing}
        onClosed={(r) => {
          setRun(r);
          setClosing(false);
        }}
      />
      <ConfirmDialog
        open={slotToDelete !== null}
        onOpenChange={(o) => !o && setSlotToDelete(null)}
        title={`Delete slot ${slotToDelete?.number}?`}
        description={`${count(slotToDelete?.packets ?? 0)} packets go back to pending. The other slots keep their numbers.`}
        confirm="Delete slot"
        onConfirm={async () => {
          if (!slotToDelete) return;
          setRun(await deleteProductionSlot(run.id, slotToDelete.id));
          setSlotToDelete(null);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${run.name}?`}
        description={`The production, everything bought for it and its ${run.slots} ${run.slots === 1 ? "slot" : "slots"} are deleted for good.`}
        confirm="Delete production"
        onConfirm={async () => {
          await deleteProductionRun(run.id);
          router.push(listHref);
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums @3xl:text-3xl",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
          tone === "warn" && "text-amber-700 dark:text-amber-400"
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function Line({
  label,
  detail,
  amount,
  muted = false,
}: {
  label: string;
  detail: string;
  amount: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className={cn("font-medium", muted && "text-muted-foreground")}>{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
      <span className={cn("tabular-nums", muted && "text-muted-foreground")}>{taka(amount)}</span>
    </div>
  );
}

// --- Receiving a slot ------------------------------------------------------------

type SlotLine = { key: number; label: string; basis: SlotCostBasis; rate: string; amount: string };

let lastLineKey = 0;
function lineKey(): number {
  lastLineKey += 1;
  return lastLineKey;
}

function lineFrom(c: SlotCost, keepAmount: boolean): SlotLine {
  return {
    key: lineKey(),
    label: c.label,
    basis: c.basis,
    rate: c.rate === null ? "" : String(c.rate),
    amount: keepAmount && c.basis === "fixed" && c.amount ? String(c.amount) : "",
  };
}

const RATE = /^\d+(\.\d{1,2})?$/;

/** The drawer for receiving a slot, or correcting one: the day, the
 *  packets (pieces follow), and what the delivery cost. A new slot starts
 *  from the last slot's lines and rates. */
function SlotSheet({
  run,
  slot,
  startCosts,
  onClose,
  onSaved,
}: {
  run: ProductionRun;
  slot: ProductionSlot | null;
  startCosts: SlotCost[];
  onClose: () => void;
  onSaved: (run: ProductionRun) => void;
}) {
  const today = dhakaToday();
  const [receivedOn, setReceivedOn] = React.useState(slot?.receivedOn ?? today);
  const [packets, setPackets] = React.useState(slot ? String(slot.packets) : "");
  const [lines, setLines] = React.useState<SlotLine[]>(() =>
    (slot ? slot.costs : startCosts).map((c) => lineFrom(c, slot !== null))
  );
  const [note, setNote] = React.useState(slot?.note ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const room = run.pending + (slot?.packets ?? 0);
  const n = /^\d+$/.test(packets) ? Number(packets) : 0;
  const pieces = n * run.piecesPerPacket;
  const amounts = lines.map((l) =>
    slotLineAmount(l.basis, num(l.rate), /^\d+$/.test(l.amount) ? Number(l.amount) : null, n, run.piecesPerPacket)
  );
  const total = amounts.reduce((s, a) => s + a, 0);
  const setLine = (key: number, patch: Partial<SlotLine>) =>
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const problem =
    n < 1
      ? "How many packets came?"
      : n > room
        ? `Only ${count(room)} packets are pending.`
        : receivedOn < run.openedOn
          ? "The slot cannot come before the production was opened."
          : lines.some((l) => l.label.trim() && l.basis !== "fixed" && l.rate.trim() && !RATE.test(l.rate.trim()))
            ? "A rate is not a number (up to 2 decimals)."
            : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveProductionSlot(
        run.id,
        {
          receivedOn,
          packets: n,
          costs: lines
            .filter((l) => l.label.trim())
            .map((l) => ({
              label: l.label.trim(),
              basis: l.basis,
              rate: l.basis === "fixed" ? null : l.rate.trim() || null,
              amount: l.basis === "fixed" ? (/^\d+$/.test(l.amount) ? Number(l.amount) : 0) : null,
            })),
          note: note.trim() || null,
        },
        slot?.id
      );
      onSaved(saved);
    } catch (err) {
      setError(fail(err, "Could not save the slot"));
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {slot ? `Edit slot ${slot.number}` : `Receive slot ${(run.slotList.at(-1)?.number ?? 0) + 1}`}
          </SheetTitle>
          <SheetDescription>
            {run.name} · {count(room)} packets {slot ? "available for this slot" : "pending"}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="slot-date">Received on</Label>
              <Input
                id="slot-date"
                type="date"
                value={receivedOn}
                min={run.openedOn}
                max={today}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="slot-packets">Packets received</Label>
              <Input
                id="slot-packets"
                inputMode="numeric"
                placeholder={String(Math.min(room, 3000))}
                value={packets}
                onChange={(e) => setPackets(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            {count(n)} packets × {run.piecesPerPacket} = <span className="font-semibold">{count(pieces)} pieces</span>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold">Costs of this slot</div>
            {lines.map((l, i) => (
              <div key={l.key} className="grid gap-2 rounded-lg border p-3">
                <div className="flex gap-2">
                  <Input
                    aria-label="Cost"
                    placeholder="Labour charge"
                    value={l.label}
                    maxLength={80}
                    onChange={(e) => setLine(l.key, { label: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${l.label || "line"}`}
                    onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-2">
                  <Select value={l.basis} onValueChange={(v) => setLine(l.key, { basis: v as SlotCostBasis })}>
                    <SelectTrigger aria-label="Worked out" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(BASIS_LABELS) as SlotCostBasis[]).map((b) => (
                        <SelectItem key={b} value={b}>
                          {BASIS_LABELS[b]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {l.basis === "fixed" ? (
                    <Input
                      aria-label="Amount"
                      inputMode="numeric"
                      placeholder="৳ 0"
                      value={l.amount}
                      onChange={(e) => setLine(l.key, { amount: e.target.value.replace(/[^\d]/g, "") })}
                    />
                  ) : (
                    <Input
                      aria-label="Rate"
                      inputMode="decimal"
                      placeholder="Rate ৳"
                      value={l.rate}
                      onChange={(e) => setLine(l.key, { rate: e.target.value })}
                    />
                  )}
                  <span className="text-right text-sm font-medium tabular-nums">{taka(amounts[i])}</span>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="justify-self-start gap-1.5"
              onClick={() =>
                setLines((p) => [...p, { key: lineKey(), label: "", basis: "fixed", rate: "", amount: "" }])
              }
            >
              <Plus className="size-4" />
              Add cost
            </Button>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="slot-note">Note</Label>
            <Input id="slot-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <SheetFooter className="sticky bottom-0 border-t bg-background">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total payable</span>
            <span className="text-2xl font-semibold tabular-nums">{taka(total)}</span>
          </div>
          {(error || (problem && n > 0)) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? problem}
            </p>
          )}
          <Button size="lg" disabled={busy || problem !== null} onClick={save} className="gap-1.5">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {slot ? "Save slot" : "Receive slot"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// --- Closing ---------------------------------------------------------------------

/** Closing records the raw material used. With packets still pending (a
 *  super admin only), it says so plainly and asks to be confirmed. */
function CloseDialog({
  run,
  open,
  onOpenChange,
  onClosed,
}: {
  run: ProductionRun;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: (run: ProductionRun) => void;
}) {
  const early = run.pending > 0;
  const [usedKg, setUsedKg] = React.useState("");
  const [understood, setUnderstood] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bad = usedKg.trim() !== "" && !/^\d+(\.\d{1,3})?$/.test(usedKg.trim());

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      onClosed(await closeProductionRun(run.id, { rawUsedKg: usedKg.trim() || null, early }));
    } catch (err) {
      setError(fail(err, "Could not close"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{early ? "Close this production early?" : "Close this production"}</DialogTitle>
          <DialogDescription>
            A closed production is read only; a super admin can reopen it.
          </DialogDescription>
        </DialogHeader>
        {early && (
          <div className="flex gap-3 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-semibold">{count(run.pending)} of {count(run.units)} packets are still pending.</span>{" "}
              Closing now ends the order at {count(run.received)} packets, and cost per packet is worked out
              over those.
            </p>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="used-kg">Raw material used (kg)</Label>
          <Input
            id="used-kg"
            inputMode="decimal"
            placeholder={run.rawKg !== null ? `of ${run.rawKg} kg bought` : "kg"}
            value={usedKg}
            onChange={(e) => setUsedKg(e.target.value)}
          />
          {bad && <p className="text-xs text-destructive">Not a number.</p>}
        </div>
        {early && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} />
            I understand, close it with {count(run.pending)} packets pending
          </label>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={early ? "destructive" : "default"}
            disabled={busy || bad || (early && !understood)}
            onClick={close}
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {early ? "Close early" : "Close production"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            className="gap-1.5"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
              } catch (err) {
                setError(fail(err, "Could not delete"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
