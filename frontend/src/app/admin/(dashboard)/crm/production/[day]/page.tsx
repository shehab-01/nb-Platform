"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileDown, Loader2, Pencil } from "lucide-react";
import { useAuth } from "@/components/admin/auth-context";
import { ProductionOnly } from "@/components/admin/production/access";
import { DayDashboard, ProductionHeader } from "@/components/admin/production/day-dashboard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProductionDay,
  getProductionReport,
  listProductionProducts,
  type ProductionDay,
  type ProductionProduct,
} from "@/lib/api";

/** One production as a dashboard, read only: a PDF report for anyone who
 *  can see it, and Edit for production admins. */
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
          {record && can("production.admin") && (
            <Button
              size="lg"
              className="h-12 gap-1.5 rounded-xl px-5"
              onClick={() => router.push(`/admin/crm/production/${day}/edit`)}
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
        </ProductionHeader>
        {reportError && <p className="mt-2 text-right text-sm text-destructive">{reportError}</p>}
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
    </div>
  );
}
