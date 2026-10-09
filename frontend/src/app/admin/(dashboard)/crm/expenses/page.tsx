"use client";

import * as React from "react";
import {
  BarChart3,
  CalendarDays,
  Clock3,
  LayoutGrid,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  Receipt,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/components/admin/auth-context";
import { EXPENSE_ICONS, ExpenseIcon } from "@/components/admin/expense-icons";
import {
  MAX_PROOFS,
  PendingProofs,
  ProofCell,
  ProofGallery,
  ProofStage,
} from "@/components/admin/expenses/proofs";
import { PhoneDropPanel, usePhoneDrop } from "@/components/admin/expenses/phone-drop";
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
import { Textarea } from "@/components/ui/textarea";
import {
  addExpense,
  addExpenseCategory,
  deleteExpenseCategory,
  deleteExpense,
  editExpense,
  getExpenseSummary,
  getExpenseTrend,
  uploadExpenseProofs,
  listExpenseCategories,
  listExpenses,
  PAYMENT_METHODS,
  type Expense,
  type ExpenseCategory,
  type ExpenseSummary,
  type PaymentMethod,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// --- Dhaka days ----------------------------------------------------------------

function dhakaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function timeOf(instant: string | Date): string {
  return new Date(instant).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function dateOf(instant: string | Date): string {
  return new Date(instant).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;

const METHOD_LABEL = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label])
) as Record<PaymentMethod, string>;

/** "+8% vs yesterday" — neutral ink: for spending, up is not good news by
 *  itself, and the page does not pretend to know. */
function change(now: number, before: number): string | null {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

// --- The page ----------------------------------------------------------------

type DrawerState = { mode: "add" } | { mode: "edit"; expense: Expense } | null;

/**
 * Expenses, per store, for super admins and whoever they gave CRM access
 * (Users → Assign CRM). A bento of the day's
 * figures; "Add expense" opens a drawer on the right that the bento makes
 * room for rather than hides behind, so the day stays in view while adding.
 */
export default function ExpensesPage() {
  const { store, can } = useAuth();
  if (!store || !can("crm")) {
    return (
      <p className="text-sm text-muted-foreground">
        The CRM is open to super admins and the people they give access to.
      </p>
    );
  }
  return <ExpensesView key={store.storeId} />;
}

function ExpensesView() {
  const today = dhakaToday();
  const [day, setDay] = React.useState(today);
  const [expenses, setExpenses] = React.useState<Expense[] | null>(null);
  const [summary, setSummary] = React.useState<ExpenseSummary | null>(null);
  const [categories, setCategories] = React.useState<ExpenseCategory[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [drawer, setDrawer] = React.useState<DrawerState>(null);
  const [deleting, setDeleting] = React.useState<Expense | null>(null);
  const [viewing, setViewing] = React.useState<Expense | null>(null);
  const [version, setVersion] = React.useState(0);
  const reload = React.useCallback(() => setVersion((v) => v + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([listExpenses(day), getExpenseSummary(day), listExpenseCategories()])
      .then(([e, s, c]) => {
        if (cancelled) return;
        setExpenses(e);
        setSummary(s);
        setCategories(c);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [day, version]);

  const isToday = day === today;
  const largest = expenses?.length
    ? expenses.reduce((a, b) => (b.amount > a.amount ? b : a))
    : null;

  return (
    <div className="flex items-start gap-6">
      {/* Full width; while the drawer is open the page narrows beside it
          and reflows by its own width (container queries), not the
          screen's. */}
      <div className="@container min-w-0 flex-1 pb-20 lg:pb-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the store spends, day by day.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* --- Four figures -------------------------------------------- */}
        <div className="mt-6 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
          <StatTile
            label={isToday ? "Today's total" : `Total, ${dayLabel(day)}`}
            value={summary?.day_total}
            note={
              summary &&
              (change(summary.day_total, summary.previous_day_total)
                ? `${change(summary.day_total, summary.previous_day_total)} vs the day before`
                : "Nothing the day before")
            }
            emphasis
          />
          <StatTile
            label="This month so far"
            value={summary?.month_total}
            note={
              summary &&
              (change(summary.month_total, summary.previous_month_total)
                ? `${change(summary.month_total, summary.previous_month_total)} vs same days last month`
                : "Nothing the same days last month")
            }
          />
          <StatTile
            label="Entries"
            value={summary?.day_count}
            plain
            note={isToday ? "today" : dayLabel(day)}
          />
          <StatTile
            label="Largest"
            value={expenses ? (largest?.amount ?? 0) : undefined}
            note={largest?.item ?? "—"}
          />
        </div>

        {/* --- The day's expenses, a table inside its own card ----------- */}
        <Card className="mt-4">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 px-3 sm:px-6">
            <div className="grid gap-2">
              <CardTitle className="flex items-center gap-2">
                <Receipt className="size-4 text-muted-foreground" />
                {isToday ? "Today's expenses" : `Expenses, ${dayLabel(day)}`}
              </CardTitle>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  aria-label="Day"
                  value={day}
                  max={today}
                  onChange={(e) => e.target.value && setDay(e.target.value)}
                  className="w-44 pl-8"
                />
              </div>
            </div>
            {/* On phones the floating + button does this. */}
            <Button
              onClick={() => setDrawer({ mode: "add" })}
              className="hidden gap-1.5 lg:inline-flex"
            >
              <Plus className="size-4" />
              Add expense
            </Button>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <ExpenseTable
              rows={expenses}
              onAdd={() => setDrawer({ mode: "add" })}
              onOpen={setViewing}
              onEdit={(e) => setDrawer({ mode: "edit", expense: e })}
              onDelete={setDeleting}
            />
          </CardContent>
        </Card>

        {/* --- Breakdown and trend ---------------------------------------- */}
        <div className="mt-4 grid gap-4 @4xl:grid-cols-5">
          <Card className="@4xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChartIcon className="size-4 text-muted-foreground" />
                {isToday ? "Today's breakdown" : `Breakdown, ${dayLabel(day)}`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary ? (
                <CategoryDonut
                  rows={summary.by_category}
                  total={summary.day_total}
                  categories={categories}
                />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </CardContent>
          </Card>
          <TrendCard
            className="@4xl:col-span-3"
            day={day}
            version={version}
            onPick={setDay}
          />
        </div>

        {/* --- Every category's spend for the day ------------------------ */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-muted-foreground" />
              Recent expenses
              <span className="text-sm font-normal text-muted-foreground">
                · {isToday ? "today" : dayLabel(day)}, by category
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary ? (
              <CategoryTiles
                rows={summary.by_category}
                total={summary.day_total}
                categories={categories}
              />
            ) : (
              <Skeleton className="h-20 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* On a phone, adding is one tap from anywhere on the page. */}
      {!drawer && (
        <Button
          aria-label="Add expense"
          onClick={() => setDrawer({ mode: "add" })}
          className="fixed right-4 z-30 size-14 rounded-full shadow-lg lg:hidden"
          style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          <Plus className="size-6" />
        </Button>
      )}

      {/* --- The drawer ------------------------------------------------- */}
      {drawer && (
        <ExpenseDrawer
          key={drawer.mode === "edit" ? `edit-${drawer.expense.id}` : "add"}
          state={drawer}
          categories={categories}
          onCategories={setCategories}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            // A new expense is spent now, so show today.
            if (drawer.mode === "add") setDay(today);
            setDrawer(null);
            reload();
          }}
        />
      )}

      <ExpenseDetails
        expense={viewing}
        categories={categories}
        onClose={() => setViewing(null)}
        onEdit={(e) => {
          setViewing(null);
          setDrawer({ mode: "edit", expense: e });
        }}
        onDelete={(e) => {
          setViewing(null);
          setDeleting(e);
        }}
      />

      <DeleteDialog
        expense={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          reload();
        }}
      />
    </div>
  );
}

// --- Cells -----------------------------------------------------------------------

function StatTile({
  label,
  value,
  note,
  emphasis = false,
  plain = false,
}: {
  label: string;
  value: number | undefined;
  note?: string | null | false;
  emphasis?: boolean;
  /** A count, not money. */
  plain?: boolean;
}) {
  return (
    <Card className={cn("gap-1 py-4", emphasis && "border-primary/30 bg-primary/5")}>
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">
          {value === undefined ? (
            <Skeleton className="h-8 w-24" />
          ) : plain ? (
            value.toLocaleString("en-IN")
          ) : (
            taka(value)
          )}
        </div>
        {note && <div className="mt-1 truncate text-xs text-muted-foreground">{note}</div>}
      </CardContent>
    </Card>
  );
}

/** Column widths as shares of the table, so on a wide screen the room is
 *  divided in proportion rather than all going to one column. Shared by the
 *  scrolling rows and the pinned total so the two line up (both tables are
 *  table-fixed); the table's min-width keeps them usable when narrow. */
const COL_WIDTHS = [
  "4%", // #
  "8%", // Time
  "12%", // Category
  "17%", // Item / details
  "9%", // Amount
  "10%", // Payment method
  "10%", // Added by
  "16%", // Note
  "6%", // Proof
  "8%", // Actions
];

function Cols() {
  return (
    <colgroup>
      {COL_WIDTHS.map((width, i) => (
        <col key={i} style={{ width }} />
      ))}
    </colgroup>
  );
}

/**
 * The day's expenses. The rows scroll inside a tall box with the column
 * heads pinned on top and the total pinned underneath, so a long day never
 * pushes the total out of sight. Long items and notes wrap (up to three
 * lines); clicking a row opens all of it.
 */
function ExpenseTable({
  rows,
  onAdd,
  onOpen,
  onEdit,
  onDelete,
}: {
  rows: Expense[] | null;
  onAdd: () => void;
  onOpen: (e: Expense) => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
}) {
  if (rows === null) return <Skeleton className="h-96 w-full" />;
  if (rows.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
        <Wallet className="size-8 text-muted-foreground" />
        <p className="font-medium">Nothing spent this day</p>
        <Button variant="outline" size="sm" onClick={onAdd} className="mt-1 gap-1.5">
          <Plus className="size-4" />
          Add expense
        </Button>
      </div>
    );
  }
  const total = rows.reduce((n, e) => n + e.amount, 0);
  const wrap = "line-clamp-3 whitespace-normal wrap-break-word";
  return (
    <>
      {/* Narrow (a phone, or a laptop with the drawer open): cards. The
          switch follows the page's own width, not the screen's. */}
      <ExpenseCards rows={rows} total={total} onOpen={onOpen} />
      <div className="hidden overflow-x-auto rounded-lg border @3xl:block">
        <div className="flex h-96 min-w-5xl flex-col @5xl:h-120">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full table-fixed text-sm">
              <Cols />
              <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Item / details</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount (৳)</th>
                  <th className="px-3 py-2.5 font-medium">Payment method</th>
                  <th className="px-3 py-2.5 font-medium">Added by</th>
                  <th className="px-3 py-2.5 font-medium">Note</th>
                  <th className="px-3 py-2.5 font-medium">Proof</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((e, i) => (
                  <tr
                    key={e.id}
                    tabIndex={0}
                    onClick={() => onOpen(e)}
                    onKeyDown={(k) => k.key === "Enter" && onOpen(e)}
                    className="cursor-pointer align-top outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      {timeOf(e.spent_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className={wrap}>{e.category}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className={wrap}>{e.item}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {e.amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {METHOD_LABEL[e.payment_method] ?? e.payment_method}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className={wrap}>{e.added_by_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      <div className={wrap}>{e.note || "—"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <ProofCell proofs={e.proofs} />
                    </td>
                    <td className="px-4 py-1.5">
                      {/* The buttons act on their own; a click on the rest of
                          the row opens the details. */}
                      <div
                        className="flex justify-end gap-1"
                        onClick={(k) => k.stopPropagation()}
                        onKeyDown={(k) => k.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${e.item}`}
                          onClick={() => onEdit(e)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${e.item}`}
                          onClick={() => onDelete(e)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <table className="w-full table-fixed border-t text-sm">
            <Cols />
            <tfoot>
              <tr className="bg-muted font-semibold">
                <td className="px-4 py-3" colSpan={4}>
                  Total{" "}
                  <span className="font-normal text-muted-foreground">
                    · {rows.length} {rows.length === 1 ? "entry" : "entries"}
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{taka(total)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * The day's expenses for a narrow page: one card each, the amount where the
 * eye lands first. A tap opens the details, which carry Edit and Delete —
 * no small icons to hit with a thumb. The total sits on top, so it is seen
 * without scrolling past every card.
 */
function ExpenseCards({
  rows,
  total,
  onOpen,
}: {
  rows: Expense[];
  total: number;
  onOpen: (e: Expense) => void;
}) {
  return (
    <div className="flex flex-col gap-2 @3xl:hidden">
      <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2.5 text-sm">
        <span className="font-semibold">
          Total{" "}
          <span className="font-normal text-muted-foreground">
            · {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </span>
        </span>
        <span className="font-semibold tabular-nums">{taka(total)}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((e, i) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onOpen(e)}
              className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">#{i + 1}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{timeOf(e.spent_at)}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{e.category}</span>
                </div>
                <div className="mt-1 line-clamp-2 font-medium wrap-break-word">{e.item}</div>
                {e.note && (
                  <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground wrap-break-word">
                    {e.note}
                  </div>
                )}
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {METHOD_LABEL[e.payment_method] ?? e.payment_method} · {e.added_by_name}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-base font-semibold tabular-nums">{taka(e.amount)}</span>
                {e.proofs.length > 0 && <ProofCell proofs={e.proofs} />}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Everything about one expense, opened from its row. */
function ExpenseDetails({
  expense,
  categories,
  onClose,
  onEdit,
  onDelete,
}: {
  expense: Expense | null;
  categories: ExpenseCategory[];
  onClose: () => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
}) {
  const e = expense;
  const iconKey = categories.find((c) => c.name === e?.category)?.icon;
  // With proofs the modal opens wide, the proof large beside the details;
  // without, it stays a small card.
  const wide = (e?.proof_count ?? 0) > 0;
  return (
    <Dialog open={e !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[94vh] flex-col",
          wide ? "sm:max-w-[min(72rem,94vw)]" : "sm:max-w-md"
        )}
      >
        {e && (
          <>
            <DialogHeader>
              <DialogTitle className="break-words pr-6">{e.item}</DialogTitle>
              <DialogDescription>
                {dateOf(e.spent_at)}, {timeOf(e.spent_at)}
              </DialogDescription>
            </DialogHeader>
            <div
              className={cn(
                "-mx-6 min-h-0 flex-1 overflow-y-auto px-6",
                wide && "grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
              )}
            >
              {wide && <ProofStage expenseId={e.id} />}
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border bg-muted/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="text-2xl font-semibold tabular-nums">{taka(e.amount)}</div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <DetailField label="Category">
                    <span className="inline-flex items-center gap-1.5">
                      <ExpenseIcon icon={iconKey} className="size-4 text-muted-foreground" />
                      {e.category}
                    </span>
                  </DetailField>
                  <DetailField label="Payment method">
                    {METHOD_LABEL[e.payment_method] ?? e.payment_method}
                  </DetailField>
                  <DetailField label="Added by">{e.added_by_name}</DetailField>
                  <DetailField label="Entry">#{e.id}</DetailField>
                  <div className="col-span-2">
                    <DetailField label="Note">
                      {e.note ? (
                        <span className="whitespace-pre-wrap">{e.note}</span>
                      ) : (
                        <span className="text-muted-foreground">No note</span>
                      )}
                    </DetailField>
                  </div>
                </dl>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => onDelete(e)}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
              <Button className="gap-1.5" onClick={() => onEdit(e)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const SLOTS = 8;

/** A category's colour: its place in the store's category list, the same on
 *  every day and in every chart; past the eighth, the shared "Other" grey. */
function slotColor(slot: number): string {
  return slot < SLOTS ? `var(--cat-${slot + 1})` : "var(--cat-other)";
}


/** The day's spend by category, one tile for each category that had any,
 *  its icon tinted with the category's colour. */
function CategoryTiles({
  rows,
  total,
  categories,
}: {
  rows: { label: string; amount: number }[];
  total: number;
  categories: ExpenseCategory[];
}) {
  const spent = new Map(rows.map((r) => [r.label, r.amount]));
  // Categories that have since been renamed or removed still show if spent.
  const names = [
    ...categories.map((c) => c.name),
    ...rows.map((r) => r.label).filter((l) => !categories.some((c) => c.name === l)),
  ];
  // Only what had spending that day. The colour slot is taken from the full
  // list first, so a category keeps its donut colour whatever else is shown.
  const shown = names
    .map((name, slot) => ({ name, slot }))
    .filter(({ name }) => (spent.get(name) ?? 0) > 0);
  if (shown.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing spent.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-7">
      {shown.map(({ name, slot: i }) => {
        const amount = spent.get(name) ?? 0;
        const iconKey = categories.find((c) => c.name === name)?.icon;
        const color = slotColor(i);
        return (
          <div
            key={name}
            className="flex items-start gap-3 rounded-lg border p-3"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full"
              style={{
                color,
                background: `color-mix(in oklab, ${color} 14%, transparent)`,
              }}
              aria-hidden
            >
              <ExpenseIcon icon={iconKey} className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs text-muted-foreground">{name}</div>
              <div className="font-semibold tabular-nums">{taka(amount)}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {total ? `${((amount / total) * 100).toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The day by category as a donut, the legend beside it carrying every
 * amount and share (three light-mode slots are under 3:1 on the surface, so
 * the labels are what make the chart readable, not the colours).
 *
 * A category's colour is its place in the store's category list, so it is
 * the same on every day; slices run in that order, which keeps neighbouring
 * slices to neighbouring slots — the pairs the palette was validated on.
 * Past eight categories the rest fold into "Other".
 */
function CategoryDonut({
  rows,
  total,
  categories,
}: {
  rows: { label: string; amount: number }[];
  total: number;
  categories: ExpenseCategory[];
}) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Nothing spent.</p>;
  }
  const slotOf = new Map(categories.map((c, i) => [c.name, i]));
  const slices: { label: string; amount: number; slot: number }[] = [];
  let other = 0;
  for (const r of rows) {
    const slot = slotOf.get(r.label) ?? SLOTS;
    if (slot < SLOTS) slices.push({ ...r, slot });
    else other += r.amount;
  }
  slices.sort((a, b) => a.slot - b.slot);
  if (other) slices.push({ label: "Other", amount: other, slot: SLOTS });
  const color = slotColor;
  const pct =(n: number) => `${((n / total) * 100).toFixed(1)}%`;

  return (
    <div className="flex flex-col items-center gap-5 @md:flex-row @md:items-center">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="amount"
              nameKey="label"
              innerRadius="64%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              // A 2px surface gap between slices.
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.label} fill={color(s.slot)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTip
                    title={String(payload[0].name)}
                    value={`${taka(Number(payload[0].value))} · ${pct(Number(payload[0].value))}`}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold">{taka(total)}</span>
          <span className="text-xs text-muted-foreground">total</span>
        </div>
      </div>
      <ul className="grid w-full min-w-0 gap-2 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: color(s.slot) }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="tabular-nums">{s.amount.toLocaleString("en-IN")}</span>
            <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
              {pct(s.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 3 months" },
];

/** Total spent per day over a chosen range, ending on the page's day. One
 *  series, so one hue and no legend; hover any column for its figure, click
 *  it to open that day. */
function TrendCard({
  day,
  version,
  onPick,
  className,
}: {
  day: string;
  version: number;
  onPick: (day: string) => void;
  className?: string;
}) {
  const [days, setDays] = React.useState(7);
  const [rows, setRows] = React.useState<{ label: string; amount: number }[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getExpenseTrend(day, days)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [day, days, version]);

  const short = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          Daily expense trend
        </CardTitle>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {RANGES.map((r) => (
              <SelectItem key={r.days} value={String(r.days)}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tickFormatter={short}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  minTickGap={12}
                />
                <YAxis
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={(n: number) =>
                    n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)
                  }
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <ChartTip
                        title={short(String(payload[0].payload.label))}
                        value={taka(Number(payload[0].value))}
                      />
                    ) : null
                  }
                />
                <Bar
                  dataKey="amount"
                  fill="var(--dash-1)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                  isAnimationActive={false}
                  className="cursor-pointer"
                  onClick={(d: { payload?: { label?: string } }) =>
                    d.payload?.label && onPick(d.payload.label)
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartTip({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
      <div className="text-muted-foreground">{title}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// --- The drawer ----------------------------------------------------------------

function ExpenseDrawer({
  state,
  categories,
  onCategories,
  onClose,
  onSaved,
}: {
  state: NonNullable<DrawerState>;
  categories: ExpenseCategory[];
  onCategories: (c: ExpenseCategory[]) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user, isSuperAdmin } = useAuth();
  const ownName = user.nickname || user.name;
  const editing = state.mode === "edit" ? state.expense : null;

  const [category, setCategory] = React.useState(editing?.category ?? "");
  const [item, setItem] = React.useState(editing?.item ?? "");
  const [amount, setAmount] = React.useState(editing ? String(editing.amount) : "");
  const [method, setMethod] = React.useState<PaymentMethod | "">(
    editing?.payment_method ?? "cash"
  );
  const [note, setNote] = React.useState(editing?.note ?? "");
  const [addedBy, setAddedBy] = React.useState(editing?.added_by_name ?? ownName);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Proof files picked here, uploaded after the expense itself is saved.
  const [files, setFiles] = React.useState<File[]>([]);
  const [attached, setAttached] = React.useState(editing?.proof_count ?? 0);
  // Set when the expense saved but its proofs did not: Save then only
  // retries the upload, so a retry never adds the expense twice.
  const [savedId, setSavedId] = React.useState<number | null>(null);
  // Pictures sent from a phone through a QR code (see phone-drop.tsx).
  const phone = usePhoneDrop();

  // The moment it will be saved with, ticking while the drawer is open.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    if (editing) return;
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, [editing]);
  const stamp = editing ? editing.spent_at : now;

  // Below lg the drawer covers the page: the page behind must not scroll.
  React.useEffect(() => {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  // Escape closes, as a drawer should.
  React.useEffect(() => {
    // Not while a modal (the category manager) is open: its Escape is its own.
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" &&
      !document.querySelector('[role="dialog"][data-state="open"]') &&
      onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const value = Number(amount);
  const valid =
    category !== "" &&
    item.trim() !== "" &&
    Number.isInteger(value) &&
    value > 0 &&
    method !== "" &&
    (!isSuperAdmin || addedBy.trim() !== "");

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const input = {
      category,
      item: item.trim(),
      amount: value,
      payment_method: method as PaymentMethod,
      note: note.trim() || null,
      // Only a super admin's choice is honoured; the API ignores the rest.
      added_by_name: isSuperAdmin ? addedBy.trim() : null,
    };
    let id = savedId;
    try {
      if (id === null) {
        id = editing ? (await editExpense(editing.id, input)).id : (await addExpense(input)).id;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
      return;
    }
    const failed = (err: unknown) => {
      setSavedId(id);
      setError(
        `The expense is saved, but the proof did not upload: ${
          err instanceof Error ? err.message : "unknown error"
        }. Save again to retry, or close and add it later.`
      );
      setSaving(false);
    };
    if (files.length) {
      try {
        await uploadExpenseProofs(id, files);
        // Done: a retry must not send these twice.
        setFiles([]);
      } catch (err) {
        failed(err);
        return;
      }
    }
    // Pictures sent from a phone: moved into the day's folder and attached.
    try {
      await phone.attach(id);
    } catch (err) {
      failed(err);
      return;
    }
    onSaved();
  };

  return (
    <>
      {/* Below lg there is no room beside the bento: the drawer covers it. */}
      <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={onClose} />
      <aside
        aria-label={editing ? "Edit expense" : "Add expense"}
        // From lg up: flush under the sticky 3.5rem top bar and against the
        // window's right edge (the negative margins undo the page padding),
        // full height, on the bar's own white so it reads as a panel.
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-card shadow-xl animate-in slide-in-from-right duration-300 lg:sticky lg:top-14 lg:z-20 lg:-my-6 lg:-mr-6 lg:h-[calc(100svh-3.5rem)] lg:w-96 lg:max-w-none lg:shrink-0 lg:shadow-[-12px_0_24px_-16px_rgb(0_0_0/0.25)]"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold">{editing ? "Edit expense" : "Add expense"}</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <form
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {/* Date and time are never typed: the server stamps the save. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                <CalendarDays className="size-4 text-muted-foreground" />
                {dateOf(stamp)}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Time</Label>
              <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm tabular-nums">
                <Clock3 className="size-4 text-muted-foreground" />
                {timeOf(stamp)}
              </div>
            </div>
            <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
              {editing
                ? "When it was spent stays as recorded."
                : "Set automatically to the moment you save."}
            </p>
          </div>

          <CategoryField
            value={category}
            onChange={setCategory}
            categories={categories}
            onCategories={onCategories}
          />

          <div className="grid gap-1.5">
            <Label htmlFor="exp-item">Item / details</Label>
            <Input
              id="exp-item"
              value={item}
              maxLength={200}
              placeholder="e.g. Vegetables, gas cylinder, delivery charge"
              onChange={(e) => setItem(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="exp-amount">Amount (৳)</Label>
              <Input
                id="exp-amount"
                inputMode="numeric"
                value={amount}
                placeholder="0"
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Payment method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="exp-by">Added by</Label>
            <Input
              id="exp-by"
              value={isSuperAdmin ? addedBy : editing?.added_by_name ?? ownName}
              maxLength={120}
              disabled={!isSuperAdmin}
              onChange={(e) => setAddedBy(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isSuperAdmin
                ? "You, unless you write in someone else's name."
                : "Always you. Only a super admin can put an expense down to someone else."}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="exp-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="exp-note"
              value={note}
              maxLength={1000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>
              Proof <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            {editing && (
              <ProofGallery expenseId={editing.id} editable onChanged={setAttached} />
            )}
            <PendingProofs
              files={files}
              onChange={setFiles}
              room={MAX_PROOFS - attached - phone.files.length}
              uploading={saving && files.length > 0}
            />
            <PhoneDropPanel phone={phone} disabled={saving} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>

        <div
          className="flex gap-2 border-t px-5 pt-4"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {/* Once the expense is saved, closing must still refresh the page. */}
          <Button
            variant="outline"
            onClick={savedId === null ? onClose : onSaved}
            className="flex-1"
          >
            {savedId === null ? "Cancel" : "Close"}
          </Button>
          <Button onClick={save} disabled={!valid || saving} className="flex-1">
            {saving
              ? files.length
                ? "Uploading…"
                : "Saving…"
              : savedId !== null
                ? "Retry upload"
                : editing
                  ? "Save changes"
                  : "Save expense"}
          </Button>
        </div>
      </aside>
    </>
  );
}

/** The category picker. "+ New category" opens the category manager. */
function CategoryField({
  value,
  onChange,
  categories,
  onCategories,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: ExpenseCategory[];
  onCategories: (c: ExpenseCategory[]) => void;
}) {
  const [managing, setManaging] = React.useState(false);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label>Category</Label>
        <button
          type="button"
          onClick={() => setManaging(true)}
          className="text-xs font-medium text-primary hover:underline"
        >
          + New category
        </button>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select category" />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => {
            return (
              <SelectItem key={c.name} value={c.name}>
                <ExpenseIcon icon={c.icon} className="size-4 text-muted-foreground" />
                {c.name}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <CategoryDialog
        open={managing}
        onOpenChange={setManaging}
        categories={categories}
        onAdded={(list, name) => {
          onCategories(list);
          onChange(name);
          setManaging(false);
        }}
        onRemoved={(list, name) => {
          onCategories(list);
          // The drawer cannot keep a category that no longer exists.
          if (value === name) onChange("");
        }}
      />
    </div>
  );
}

/**
 * The store's categories: every one it has, with its icon, and a form to add
 * another — a name and an icon picked from the set. A new category is
 * selected in the drawer as soon as it is added.
 */
function CategoryDialog({
  open,
  onOpenChange,
  categories,
  onAdded,
  onRemoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ExpenseCategory[];
  onAdded: (list: ExpenseCategory[], name: string) => void;
  onRemoved: (list: ExpenseCategory[], name: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState("tag");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // The category whose delete button is asking "sure?".
  const [confirming, setConfirming] = React.useState<number | null>(null);

  // A fresh form each time it opens.
  React.useEffect(() => {
    if (open) {
      setName("");
      setIcon("tag");
      setError(null);
      setConfirming(null);
    }
  }, [open]);

  const remove = async (c: ExpenseCategory) => {
    if (c.id === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      onRemoved(await deleteExpenseCategory(c.id), c.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const clean = name.trim().replace(/\s+/g, " ");
  const taken = categories.some((c) => c.name.toLowerCase() === clean.toLowerCase());

  const add = async () => {
    if (!clean || taken || busy) return;
    setBusy(true);
    setError(null);
    try {
      onAdded(await addExpenseCategory(clean, icon), clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Expense categories</DialogTitle>
          <DialogDescription>
            Every category this store uses. Add one with a name and an icon;
            deleting one keeps it on the expenses already filed under it.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex flex-1 flex-col gap-5 overflow-y-auto px-6">
          {/* What the store has */}
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Existing · {categories.length}
            </h3>
            <ul className="grid grid-cols-2 gap-2">
              {categories.map((c) => {
                return (
                  <li
                    key={c.name}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm"
                  >
                    <ExpenseIcon icon={c.icon} className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" title={c.name}>
                      {c.name}
                    </span>
                    {c.default || c.id === null ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Default
                      </span>
                    ) : confirming === c.id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        className="h-6 px-2 text-xs"
                        onClick={() => remove(c)}
                        onBlur={() => setConfirming(null)}
                        autoFocus
                      >
                        Delete
                      </Button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${c.name}`}
                        title="Delete category"
                        onClick={() => setConfirming(c.id)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Adding one */}
          <section className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <h3 className="text-sm font-medium">Add a category</h3>
            <div className="grid gap-1.5">
              <Label htmlFor="cat-name">Name</Label>
              <div className="flex items-center gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
                  <ExpenseIcon icon={icon} className="size-4" />
                </span>
                <Input
                  id="cat-name"
                  autoFocus
                  value={name}
                  maxLength={60}
                  placeholder="e.g. Office rent"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  }}
                />
              </div>
              {taken && (
                <p className="text-xs text-destructive">That category already exists.</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Icon</Label>
              <div
                role="radiogroup"
                aria-label="Icon"
                className="grid grid-cols-8 gap-1.5"
              >
                {EXPENSE_ICONS.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={icon === key}
                    aria-label={label}
                    title={label}
                    onClick={() => setIcon(key)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md border bg-background transition-colors hover:bg-accent",
                      icon === key && "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={add} disabled={!clean || taken || busy}>
            {busy ? "Adding…" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  expense,
  onClose,
  onDeleted,
}: {
  expense: Expense | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog
      open={expense !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this expense?</DialogTitle>
          <DialogDescription>
            {expense && `${expense.item} — ${taka(expense.amount)}, ${timeOf(expense.spent_at)}.`}{" "}
            This cannot be undone.
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
              if (!expense) return;
              setBusy(true);
              try {
                await deleteExpense(expense.id);
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
