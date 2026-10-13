"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileDown, Loader2, Lock, Pencil, Send, Trash2 } from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { ProductionOnly } from "@/components/admin/production/access";
import { DayDashboard, ProductionHeader } from "@/components/admin/production/day-dashboard";
import { DeleteProductionDialog } from "@/components/admin/production/delete-dialog";
import { dayLabel, taka } from "@/components/admin/production/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProductionDay,
  getProductionReport,
  listProductionProducts,
  sendProductionToExpenses,
  type ProductionDay,
  type ProductionProduct,
} from "@/lib/api";

/** One production as a dashboard, read only: a PDF report for anyone who
 *  can see it; Edit for production admins and "Send to Expenses" for the CRM
 *  admins and whoever they assigned to Production, until it is
 *  sent (sending locks it); Delete for the CRM admins. */
export default function ProductionDayPage() {
  return (
    <ProductionOnly>
      <ProductionView />
    </ProductionOnly>
  );
}

function ProductionView() {
  const { day } = useParams<{ day: string }>();
  const router = useRouter();
  const { can } = useAuth();
  // undefined while loading; null when the date has no production.
  const [record, setRecord] = React.useState<ProductionDay | null | undefined>(undefined);
  const [products, setProducts] = React.useState<ProductionProduct[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([getProductionDay(day), listProductionProducts()])
      .then(([r, p]) => {
        if (cancelled) return;
        setRecord(r);
        setProducts(p);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [day]);

  const listHref = `/admin/crm/production?month=${day.slice(0, 7)}`;
  const [sending, setSending] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const sent = !!record?.sent_at;

  // The report is made on the server (a Word template, then a PDF) and
  // handed over as a download.
  const [reporting, setReporting] = React.useState(false);
  const [reportError, setReportError] = React.useState<string | null>(null);
  const downloadReport = async () => {
    setReporting(true);
    setReportError(null);
    try {
      const url = URL.createObjectURL(await getProductionReport(day));
      const a = document.createElement("a");
      a.href = url;
      a.download = `production-${day}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Could not make the report");
    } finally {
      setReporting(false);
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
      <div className="mt-3">
        <ProductionHeader
          title="Production"
          subtitle="এই দিনের প্রোডাকশন, কর্মী, কাঁচামাল আর মোট খরচ।"
          day={record ? record.day : null}
        >
          {record && (
            <Button
              variant="outline"
              size="lg"
              className="h-12 gap-1.5 rounded-xl px-5"
              disabled={reporting}
              onClick={downloadReport}
            >
              {reporting ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              {reporting ? "Making report…" : "Generate report"}
            </Button>
          )}
          {record && can("crm.admin") && (
            <Button
              variant="outline"
              size="lg"
              className="h-12 gap-1.5 rounded-xl px-5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}
          {record && !sent && can("production.admin") && (
            <Button
              variant="outline"
              size="lg"
              className="h-12 gap-1.5 rounded-xl px-5"
              onClick={() => router.push(`/admin/crm/production/${day}/edit`)}
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
          {/* The CRM admins and whoever they assigned to Production; a super
              admin only when assigned. */}
          {record && !sent && can("production.send") && (
            <Button
              size="lg"
              className="h-12 gap-1.5 rounded-xl px-5"
              onClick={() => setSending(true)}
            >
              <Send className="size-4" />
              Send to Expenses
            </Button>
          )}
        </ProductionHeader>
        {reportError && <p className="mt-2 text-right text-sm text-destructive">{reportError}</p>}
        {record?.sent_at && (
          <p className="mt-3 flex items-center justify-end gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-4" />
            Expenses-এ পাঠানো হয়েছে ({new Date(record.sent_at).toLocaleDateString("en-GB", {
              timeZone: "Asia/Dhaka",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}); এখন আর বদলানো যাবে না।
          </p>
        )}
      </div>

      {error ? (
        <p className="mt-6 text-sm text-destructive">{error}</p>
      ) : record === undefined ? (
        <div className="mt-6 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : record === null ? (
        <p className="mt-6 text-sm text-muted-foreground">
          এই তারিখে কোনো প্রোডাকশন নেই।{" "}
          <Link href={listHref} className="font-medium text-primary hover:underline">
            তালিকায় ফিরে যান
          </Link>
        </p>
      ) : (
        <DayDashboard record={record} products={products} />
      )}

      {record && (
        <SendDialog
          record={record}
          open={sending}
          onClose={() => setSending(false)}
          onSent={(r) => {
            setRecord(r);
            setSending(false);
          }}
        />
      )}
      <DeleteProductionDialog
        day={deleting && record ? record.day : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => router.push(listHref)}
      />
    </div>
  );
}

/** Confirms "Send to Expenses": what goes, as which expense, and that the
 *  production is locked afterwards. The server works out the amounts. */
function SendDialog({
  record,
  open,
  onClose,
  onSent,
}: {
  record: ProductionDay;
  open: boolean;
  onClose: () => void;
  onSent: (r: ProductionDay) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dd = record.day.slice(8, 10);
  const mm = record.day.slice(5, 7);
  const parts = [
    { label: "Raw materials", amount: record.materials_cost },
    { label: "Cook salary", amount: record.labour_cost },
    { label: "Other costs", amount: record.misc_cost },
  ].filter((p) => p.amount > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to Expenses?</DialogTitle>
          <DialogDescription>
            {dayLabel(record.day, { weekday: true })}-এর এই খরচগুলো Expenses-এ “From production”
            হিসেবে যাবে। পাঠানোর পর এই প্রোডাকশন আর বদলানো যাবে না, শুধু মুছে ফেলা যাবে।
          </DialogDescription>
        </DialogHeader>
        {parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">পাঠানোর মতো কোনো খরচ নেই।</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center justify-between px-3 py-2">
                <span className="font-medium">
                  {p.label} - {dd}/{mm}
                </span>
                <span className="font-semibold tabular-nums">{taka(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || parts.length === 0}
            className="gap-1.5"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onSent(await sendProductionToExpenses(record.day));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not send");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
