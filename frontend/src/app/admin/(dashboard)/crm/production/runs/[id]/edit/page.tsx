"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { BatchOnly } from "@/components/admin/production/batch/shared";
import { RunForm } from "@/components/admin/production/batch/run-form";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProductionRun,
  getProductionRunDefaults,
  type ProductionRun,
  type ProductionRunDefaults,
} from "@/lib/api";

/** Correcting an open batch production, or filling in quantities that were
 *  not known when it was opened. A closed one is read only. */
export default function EditRunPage() {
  return (
    <BatchOnly>
      <EditRun />
    </BatchOnly>
  );
}

function EditRun() {
  const { id } = useParams<{ id: string }>();
  const [loaded, setLoaded] = React.useState<{ run: ProductionRun; defaults: ProductionRunDefaults } | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([getProductionRun(Number(id)), getProductionRunDefaults()])
      .then(([run, defaults]) => !cancelled && setLoaded({ run, defaults }))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!loaded) return <Skeleton className="h-96 w-full" />;
  if (loaded.run.closed) {
    return (
      <p className="text-sm text-muted-foreground">
        This production is closed. A super admin can reopen it to make changes.
      </p>
    );
  }
  return <RunForm run={loaded.run} defaults={loaded.defaults} />;
}
