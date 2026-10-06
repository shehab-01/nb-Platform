"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthLabel, shiftMonth } from "@/lib/staff-stats";

/** ◀ October 2026 ▶ — never past the current month. */
export function MonthSwitcher({
  month,
  thisMonth,
  onMonth,
}: {
  month: string;
  thisMonth: string;
  onMonth: (month: string) => void;
}) {
  return (
    <div className="flex items-center rounded-lg border">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous month"
        onClick={() => onMonth(shiftMonth(month, -1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-32 text-center text-sm font-medium">
        {monthLabel(month)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next month"
        disabled={month >= thisMonth}
        onClick={() => onMonth(shiftMonth(month, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
