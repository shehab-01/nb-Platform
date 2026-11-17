"use client";

import * as React from "react";
import { BatchOnly } from "@/components/admin/production/batch/shared";
import { RunForm } from "@/components/admin/production/batch/run-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getProductionRunDefaults, type ProductionRunDefaults } from "@/lib/api";

/** Opening a batch production, dated today, starting from the last one's
 *  items and prices. */
export default function NewRunPage() {
  return (
    <BatchOnly>
      <NewRun />
    </BatchOnly>
  );
}

function NewRun() {
  const [defaults, setDefaults] = React.useState<ProductionRunDefaults | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getProductionRunDefaults()
      .then((d) => !cancelled && setDefaults(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!defaults) return <Skeleton className="h-96 w-full" />;
  return <RunForm run={null} defaults={defaults} />;
}
