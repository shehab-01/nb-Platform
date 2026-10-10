"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProductionAdminOnly, useProductionLists } from "@/components/admin/production/access";
import { ProductionForm } from "@/components/admin/production/production-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getProductionDay, type ProductionDay } from "@/lib/api";

/** Correcting a production (production admins only): the entry page,
 *  filled in as it was saved. */
export default function EditProductionPage() {
  return (
    <ProductionAdminOnly>
      <EditProduction />
    </ProductionAdminOnly>
  );
}

function EditProduction() {
  const { day } = useParams<{ day: string }>();
  const lists = useProductionLists();
  // undefined while loading; null when the date has no production.
  const [record, setRecord] = React.useState<ProductionDay | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getProductionDay(day)
      .then((r) => !cancelled && setRecord(r))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [day]);

  if (error || lists.error) return <p className="text-sm text-destructive">{error ?? lists.error}</p>;
  if (record === null) {
    return (
      <p className="text-sm text-muted-foreground">
        এই তারিখে কোনো প্রোডাকশন নেই।{" "}
        <Link href="/admin/crm/production" className="font-medium text-primary hover:underline">
          তালিকায় ফিরে যান
        </Link>
      </p>
    );
  }
  if (record === undefined || !lists.products || !lists.items) {
    return <Skeleton className="h-96 w-full" />;
  }
  return (
    <ProductionForm
      editing={record}
      template={null}
      products={lists.products}
      items={lists.items}
      suggestions={lists.suggestions}
      onProducts={lists.setProducts}
      onItems={lists.setItems}
    />
  );
}
