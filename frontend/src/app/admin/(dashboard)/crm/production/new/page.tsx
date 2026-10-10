"use client";

import * as React from "react";
import { ProductionOnly, useProductionLists } from "@/components/admin/production/access";
import { dhakaToday } from "@/components/admin/production/format";
import { ProductionForm } from "@/components/admin/production/production-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getProductionDay, listProductionDays, type ProductionDay } from "@/lib/api";

/** Adding a production: the entry page, dated today and empty. The latest
 *  production before today is fetched only so its bazar list can be copied. */
export default function NewProductionPage() {
  return (
    <ProductionOnly>
      <NewProduction />
    </ProductionOnly>
  );
}

function yesterday(): string {
  const d = new Date(`${dhakaToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function NewProduction() {
  const lists = useProductionLists();
  // undefined while looking; null when there is nothing to start from.
  const [template, setTemplate] = React.useState<ProductionDay | null | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    listProductionDays({ end: yesterday(), limit: 1 })
      .then(([latest]) => (latest ? getProductionDay(latest.day) : null))
      .then((t) => !cancelled && setTemplate(t))
      .catch(() => !cancelled && setTemplate(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (lists.error) return <p className="text-sm text-destructive">{lists.error}</p>;
  if (!lists.products || !lists.items || template === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }
  return (
    <ProductionForm
      editing={null}
      template={template}
      products={lists.products}
      items={lists.items}
      suggestions={lists.suggestions}
      onProducts={lists.setProducts}
      onItems={lists.setItems}
    />
  );
}
