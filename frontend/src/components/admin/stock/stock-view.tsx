"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PackageMinus,
  PackagePlus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { dayLabel, dhakaToday } from "@/components/admin/production/format";
import { count, Figure } from "@/components/admin/production/batch/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  addStockAdjustment,
  addStockReturn,
  deleteStockEntry,
  getStock,
  syncStock,
  type StockEntry,
  type StockMonth,
  type StockOption,
  type StockSyncResult,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/** The Stock page is for stores that keep stock, and for whoever may open
 *  Production there; the API refuses the rest too. */
export function StockOnly({ children }: { children: React.ReactNode }) {
  const { store, can } = useAuth();
  if (!store || !can("production")) {
    return (
      <p className="text-sm text-muted-foreground">
        Stock is open to production admins and the people they choose.
      </p>
    );
  }
  if (!store.stockEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        This store keeps no stock. A super admin can switch it on in the store form.
      </p>
    );
  }
  return <React.Fragment key={store.storeId}>{children}</React.Fragment>;
}

const MONTH = /^\d{4}-\d{2}$/;

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const fail = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** +1,200 / −30, for movements. */
const signed = (n: number) => (n > 0 ? `+${count(n)}` : n < 0 ? `−${count(-n)}` : "0");

/** What one combo averages, for "Approximate combos": the 3, 5 and
 *  10-packet combos sell in a mix that works out at about 3.5 packets
 *  each, by the client's reckoning. Rounded down: never promise more. */
const PACKETS_PER_COMBO = 3.5;
const approxCombos = (packets: number) => Math.max(Math.floor(packets / PACKETS_PER_COMBO), 0);

const DAY_COLS = "grid grid-cols-[minmax(7rem,1fr)_6rem_6rem_6rem_6rem_7rem] gap-3 px-5";

/**
 * Stock: packets in hand now, then one month of it — what it opened with,
 * what came in from production, went out through History, came back from
 * the courier — day by day, and the slots, returns and corrections behind
 * it. The month is in the URL (?month=YYYY-MM).
 */
export default function StockView() {
  return (
    // useSearchParams needs a Suspense boundary above it.
    <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Stock />
    </React.Suspense>
  );
}

function Stock() {
  const router = useRouter();
  const { can } = useAuth();
  const admin = can("production.admin");
  const params = useSearchParams();
  const thisMonth = dhakaToday().slice(0, 7);
  const asked = params.get("month") ?? "";
  const month = MONTH.test(asked) && asked <= thisMonth ? asked : thisMonth;

  const [data, setData] = React.useState<StockMonth | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [dialog, setDialog] = React.useState<"return" | "adjust" | "sync" | null>(null);
  const [removing, setRemoving] = React.useState<StockEntry | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getStock(month)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((err) => !cancelled && setError(fail(err, "Failed to load")));
    return () => {
      cancelled = true;
    };
  }, [month, version]);

  const shown = data?.month === month ? data : null;
  const go = (m: string) => router.replace(`/admin/crm/stock?month=${m}`, { scroll: false });
  const negative = data !== null && data.onHand < 0;

  return (
    <div className="@container">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Stock</h1>
        <div className="flex flex-wrap items-center gap-2">
          {admin && (
            <Button variant="outline" size="lg" className="gap-1.5" onClick={() => setDialog("sync")}>
              <RefreshCw className="size-4" />
              Sync history
            </Button>
          )}
          {admin && (
            <Button variant="outline" size="lg" className="gap-1.5" onClick={() => setDialog("adjust")}>
              <SlidersHorizontal className="size-4" />
              Correct
            </Button>
          )}
          <Button size="lg" className="gap-1.5" onClick={() => setDialog("return")} disabled={!data}>
            <Undo2 className="size-4" />
            Return
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- Now: in hand, as combos, and what is about to leave --- */}
      <Card className={cn("mt-6 gap-0 py-5", negative && "border-destructive/50 bg-destructive/5")}>
        <CardContent className="grid gap-5 px-5 @4xl:grid-cols-[auto_auto_minmax(0,1fr)] @4xl:items-stretch">
          <div className="min-w-40">
            <div className="text-sm text-muted-foreground">In stock now</div>
            <div className={cn("mt-1 text-4xl font-bold tabular-nums", negative && "text-destructive")}>
              {data ? count(data.onHand) : <Skeleton className="h-10 w-32" />}
              {data && <span className="ml-2 text-base font-medium text-muted-foreground">packets</span>}
            </div>
          </div>

          <div className="min-w-44 rounded-lg border bg-muted/30 px-4 py-3">
            <div className="text-sm text-muted-foreground">Approximate combos</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {data ? `≈ ${count(approxCombos(data.onHand))}` : <Skeleton className="h-9 w-20" />}
            </div>
            {data && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {count(data.onHand)} ÷ {PACKETS_PER_COMBO}
              </div>
            )}
          </div>

          <div className="rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm text-muted-foreground">Confirmed, not yet in History</div>
              {data && data.waitingPackets > 0 && (
                <div className="text-xs text-muted-foreground">
                  {count(data.waitingPackets)} packets to go out · stock after{" "}
                  <span
                    className={cn(
                      "font-semibold text-foreground",
                      data.onHand - data.waitingPackets < 0 && "text-destructive"
                    )}
                  >
                    {count(data.onHand - data.waitingPackets)}
                  </span>
                </div>
              )}
            </div>
            {data === null ? (
              <Skeleton className="mt-2 h-14 w-full" />
            ) : data.waiting.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No products yet.</p>
            ) : (
              <div className="mt-2 grid gap-3 @lg:grid-cols-3">
                {data.waiting.map((w) => (
                  <div key={w.variantId ?? "gone"} className="min-w-0 rounded-md bg-muted/40 px-3 py-2">
                    <div className="truncate text-xs font-medium" title={w.name}>
                      {w.stockPackets > 0 ? `${w.stockPackets}-packet combo` : w.name}
                    </div>
                    <div className="mt-0.5 text-2xl font-semibold tabular-nums">{count(w.combos)}</div>
                    <div className="text-xs text-muted-foreground">
                      {w.combos === 0
                        ? "none waiting"
                        : `${count(w.orders)} ${w.orders === 1 ? "order" : "orders"} · ${count(w.packets)} packets`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {negative && (
            <div className="flex gap-2 text-sm text-destructive @4xl:col-span-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                Below zero: more packets went to History than were received. If this store sold
                before stock was switched on, run <span className="font-medium">Sync history</span>
                ; otherwise check the slots, the returns and each option&rsquo;s packets.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Which month --- */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-40 text-center text-lg font-semibold">{monthName(month)}</div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next month"
          disabled={month >= thisMonth}
          onClick={() => go(shiftMonth(month, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        {month !== thisMonth && (
          <Button variant="ghost" size="sm" onClick={() => go(thisMonth)}>
            This month
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 @3xl:grid-cols-5">
        <Figure label="Opening" value={shown ? count(shown.opening) : undefined} />
        <Figure label="Received" value={shown ? `+${count(shown.received)}` : undefined} note="from production" />
        <Figure label="Sent" value={shown ? `−${count(shown.sent)}` : undefined} note="moved to History" />
        <Figure
          label="Returned"
          value={shown ? `+${count(shown.returned)}` : undefined}
          note={shown && shown.adjusted !== 0 ? `corrections ${signed(shown.adjusted)}` : "from the courier"}
        />
        <Figure label="Closing" value={shown ? count(shown.closing) : undefined} emphasis />
      </div>

      {/* --- Day by day --- */}
      <Card className="mt-4 gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <div className="min-w-160">
            <div className={cn(DAY_COLS, "border-b bg-muted/40 py-3 text-xs font-medium text-muted-foreground")}>
              <span>Day</span>
              <span className="text-right">Received</span>
              <span className="text-right">Sent</span>
              <span className="text-right">Returned</span>
              <span className="text-right">Corrected</span>
              <span className="text-right">Closing</span>
            </div>
            {shown === null ? (
              <div className="grid gap-2 p-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : shown.days.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">
                Nothing moved in {monthName(month)}.
              </p>
            ) : (
              shown.days.map((d) => (
                <div key={d.day} className={cn(DAY_COLS, "items-center border-b py-3 text-sm last:border-b-0")}>
                  <span className="tabular-nums">{dayLabel(d.day, { year: false, weekday: true })}</span>
                  <span className="text-right tabular-nums">{d.received ? `+${count(d.received)}` : "—"}</span>
                  <span className="text-right tabular-nums">{d.sent ? `−${count(d.sent)}` : "—"}</span>
                  <span className="text-right tabular-nums">{d.returned ? `+${count(d.returned)}` : "—"}</span>
                  <span className="text-right tabular-nums">{d.adjusted ? signed(d.adjusted) : "—"}</span>
                  <span className={cn("text-right font-semibold tabular-nums", d.closing < 0 && "text-destructive")}>
                    {count(d.closing)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* --- What was received, returned, corrected --- */}
        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle className="text-base">Slots, returns and corrections</CardTitle>
          </CardHeader>
          {shown === null ? (
            <Skeleton className="m-5 h-24" />
          ) : shown.entries.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">None in {monthName(month)}.</p>
          ) : (
            <ul className="divide-y">
              {shown.entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      e.packets >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    )}
                  >
                    {e.packets >= 0 ? <PackagePlus className="size-4" /> : <PackageMinus className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      <EntryTitle entry={e} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {dayLabel(e.onDay, { year: false })}
                      {e.createdBy && ` · ${e.createdBy}`}
                      {e.note && ` · ${e.note}`}
                    </div>
                  </div>
                  <span className="font-semibold tabular-nums">{signed(e.packets)}</span>
                  {admin && (e.kind === "return" || e.kind === "adjust") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Delete entry"
                      onClick={() => setRemoving(e)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- What History counts --- */}
        <Card className="gap-0 py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle className="text-base">Packets per option</CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-4">
            {data === null ? (
              <Skeleton className="h-20" />
            ) : data.options.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products yet.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {data.options.map((o) => (
                  <li key={o.variantId} className="flex items-baseline justify-between gap-3">
                    <span className={cn("min-w-0 truncate", !o.isActive && "text-muted-foreground")}>{o.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{count(o.stockPackets)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              An order moved to History takes each line&rsquo;s quantity × the packets it was
              ordered with, so changing these affects new orders only. Change them under{" "}
              <Link href="/admin/products" className="font-medium text-primary hover:underline">
                Products
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>

      {data && (
        <ReturnDialog
          open={dialog === "return"}
          onOpenChange={(o) => setDialog(o ? "return" : null)}
          options={data.options}
          admin={admin}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {admin && (
        <AdjustDialog
          open={dialog === "adjust"}
          onOpenChange={(o) => setDialog(o ? "adjust" : null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {admin && data && (
        <SyncDialog
          open={dialog === "sync"}
          onOpenChange={(o) => setDialog(o ? "sync" : null)}
          options={data.options}
          onSynced={reload}
        />
      )}
      <RemoveDialog
        entry={removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        onDone={() => {
          setRemoving(null);
          reload();
        }}
      />
    </div>
  );
}

function EntryTitle({ entry: e }: { entry: StockEntry }) {
  if (e.kind === "slot") {
    const label = `${e.runName ?? "Production"} · Slot ${e.slotNumber ?? ""}`.trim();
    return e.runId ? (
      <Link href={`/admin/crm/production/runs/${e.runId}`} className="hover:underline">
        {label}
      </Link>
    ) : (
      <>{label}</>
    );
  }
  if (e.kind === "return") {
    return (
      <>
        Returned · {e.combos ?? 0} × {e.variantName ?? "an option no longer sold"}
      </>
    );
  }
  return <>Correction</>;
}

function ReturnDialog({
  open,
  onOpenChange,
  options,
  admin,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: StockOption[];
  admin: boolean;
  onDone: () => void;
}) {
  const [variantId, setVariantId] = React.useState<string>("");
  const [combos, setCombos] = React.useState("");
  const [day, setDay] = React.useState(dhakaToday());
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setVariantId("");
    setCombos("");
    setDay(dhakaToday());
    setNote("");
    setError(null);
  }, [open]);

  const option = options.find((o) => String(o.variantId) === variantId) ?? null;
  const n = /^\d+$/.test(combos.trim()) ? Number(combos.trim()) : 0;
  const packets = option ? n * option.stockPackets : 0;

  const save = async () => {
    if (!option || n < 1) return;
    setBusy(true);
    setError(null);
    try {
      await addStockReturn({
        variantId: option.variantId,
        combos: n,
        onDay: day === dhakaToday() ? null : day,
        note: note.trim(),
      });
      onDone();
    } catch (err) {
      setError(fail(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Courier return</DialogTitle>
          <DialogDescription>
            Pick what came back and how many of it; its packets go back into stock.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Option</Label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose the combo" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.variantId} value={String(o.variantId)}>
                    {o.name} · {o.stockPackets} {o.stockPackets === 1 ? "packet" : "packets"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ret-combos">How many came back</Label>
              <Input
                id="ret-combos"
                inputMode="numeric"
                value={combos}
                onChange={(e) => setCombos(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ret-day">Day</Label>
              <Input
                id="ret-day"
                type="date"
                value={day}
                max={dhakaToday()}
                disabled={!admin}
                onChange={(e) => setDay(e.target.value || dhakaToday())}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ret-note">Note (optional)</Label>
            <Input
              id="ret-note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Pathao return batch, order numbers…"
            />
          </div>
          <div className="rounded-lg bg-muted/60 px-4 py-3 text-sm">
            {option && n > 0 ? (
              <>
                {count(n)} × {option.stockPackets} ={" "}
                <span className="font-semibold">+{count(packets)} packets</span> back into stock
              </>
            ) : (
              <span className="text-muted-foreground">Choose an option and how many.</span>
            )}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !option || n < 1} onClick={save} className="gap-1.5">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Add return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [direction, setDirection] = React.useState<"add" | "remove">("remove");
  const [packets, setPackets] = React.useState("");
  const [day, setDay] = React.useState(dhakaToday());
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDirection("remove");
    setPackets("");
    setDay(dhakaToday());
    setNote("");
    setError(null);
  }, [open]);

  const n = /^\d+$/.test(packets.trim()) ? Number(packets.trim()) : 0;
  const ready = n > 0 && note.trim().length > 0;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await addStockAdjustment({
        packets: direction === "add" ? n : -n,
        onDay: day === dhakaToday() ? null : day,
        note: note.trim(),
      });
      onDone();
    } catch (err) {
      setError(fail(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct the stock</DialogTitle>
          <DialogDescription>
            For what nothing else records: damaged packets, samples given away, a recount.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(["remove", "add"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                variant={direction === d ? "default" : "outline"}
                onClick={() => setDirection(d)}
                className="gap-1.5"
              >
                {d === "add" ? <PackagePlus className="size-4" /> : <PackageMinus className="size-4" />}
                {d === "add" ? "Add packets" : "Take packets off"}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="adj-packets">Packets</Label>
              <Input
                id="adj-packets"
                inputMode="numeric"
                value={packets}
                onChange={(e) => setPackets(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adj-day">Day</Label>
              <Input
                id="adj-day"
                type="date"
                value={day}
                max={dhakaToday()}
                onChange={(e) => setDay(e.target.value || dhakaToday())}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adj-note">Reason</Label>
            <Input
              id="adj-note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="12 packets damaged in the rain"
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !ready} onClick={save} className="gap-1.5">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {n > 0 ? `${direction === "add" ? "Add" : "Take off"} ${count(n)} packets` : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SyncDialog({
  open,
  onOpenChange,
  options,
  onSynced,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: StockOption[];
  onSynced: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<StockSyncResult | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
  }, [open]);

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await syncStock());
      onSynced();
    } catch (err) {
      setError(fail(err, "Could not sync"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sync history</DialogTitle>
          <DialogDescription>
            Counts every slot already received and every order already in History, and puts right
            anything that has drifted. Returns and corrections are left as they are. Safe to run
            again.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-2 rounded-lg bg-muted/60 px-4 py-3 text-sm">
            <div>
              Slots: {count(result.slotsAdded)} added, {count(result.slotsUpdated)} corrected
            </div>
            <div>
              Orders in History: {count(result.salesAdded)} added, {count(result.salesUpdated)} recounted,{" "}
              {count(result.salesRemoved)} no longer in History
            </div>
            {result.unsizedOrders > 0 && (
              <div className="text-amber-700 dark:text-amber-400">
                {count(result.unsizedOrders)} orders are from before order lines were kept; each
                counted as one packet a piece.
              </div>
            )}
            <div className="font-semibold">In stock now: {count(result.onHand)} packets</div>
          </div>
        ) : (
          <div className="flex gap-3 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">
                Each order counts the packets its line was ordered with. For reference, the options
                now hold:
              </p>
              <ul className="mt-1.5 grid gap-0.5">
                {options.map((o) => (
                  <li key={o.variantId}>
                    {o.name}: <span className="font-semibold">{o.stockPackets}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button disabled={busy} onClick={sync} className="gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Sync now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  entry,
  onOpenChange,
  onDone,
}: {
  entry: StockEntry | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setError(null), [entry]);

  const remove = async () => {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      await deleteStockEntry(entry.id);
      onDone();
    } catch (err) {
      setError(fail(err, "Could not delete"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this {entry?.kind === "return" ? "return" : "correction"}?</DialogTitle>
          <DialogDescription>
            {entry && `${signed(-entry.packets)} packets to the stock. Only for one entered by mistake.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={remove} className="gap-1.5">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
