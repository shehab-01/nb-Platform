"use client";

import { useParams } from "next/navigation";
import { BatchOnly } from "@/components/admin/production/batch/shared";
import { RunView } from "@/components/admin/production/batch/run-view";

/** One batch production: received and pending, its costs, its slots. */
export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <BatchOnly>
      <RunView id={Number(id)} />
    </BatchOnly>
  );
}
