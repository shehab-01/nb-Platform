"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { CrmOnly } from "@/components/admin/production/access";
import { DayDashboard, ProductionHeader } from "@/components/admin/production/day-dashboard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProductionDay,
  listProductionProducts,
  type ProductionDay,
  type ProductionProduct,
} from "@/lib/api";

/** One production as a dashboard, read only, with an Edit button. */
export default function ProductionDayPage() {
  return (
    <CrmOnly>
      <ProductionView />
    </CrmOnly>
  );
}

function ProductionView() {
  const { day } = useParams<{ day: string }>();
  const router = useRouter();
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
            size="lg"
            className="h-12 gap-1.5 rounded-xl px-5"
            onClick={() => router.push(`/admin/crm/production/${day}/edit`)}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        )}
        </ProductionHeader>
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
