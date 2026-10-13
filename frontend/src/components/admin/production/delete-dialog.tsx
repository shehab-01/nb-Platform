"use client";

import * as React from "react";
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
import { deleteProductionDay, listProductionExpenses, type SentExpense } from "@/lib/api";
import { dayLabel, taka } from "./format";

/**
 * "Delete this production?" — and, when it was sent to Expenses, the
 * expenses that go with it, listed so nobody deletes them unawares.
 */
export function DeleteProductionDialog({
  day,
  onClose,
  onDeleted,
}: {
  day: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [expenses, setExpenses] = React.useState<SentExpense[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!day) return;
    let cancelled = false;
    setExpenses(null);
    setError(null);
    listProductionExpenses(day)
      .then((e) => !cancelled && setExpenses(e))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [day]);

  return (
    <Dialog open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this production?</DialogTitle>
          <DialogDescription>
            {day && dayLabel(day, { weekday: true })}-এর প্রোডাকশন আর এর সব তথ্য — কাঁচামাল,
            রাঁধুনি, পণ্য, খরচ — মুছে যাবে। এটা আর ফেরানো যাবে না।
          </DialogDescription>
        </DialogHeader>

        {expenses === null ? (
          !error && <Skeleton className="h-16 w-full" />
        ) : expenses.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium text-destructive">
              Expenses থেকেও এই খরচগুলো মুছে যাবে:
            </p>
            <ul className="divide-y rounded-lg border text-sm">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{e.item}</div>
                    {e.note && (
                      <div className="truncate text-xs text-muted-foreground">{e.note}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{taka(e.amount)}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.status === "approved" ? "Approved" : "Pending"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            এটি Expenses-এ পাঠানো হয়নি, তাই সেখান থেকে কিছু মুছবে না।
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={busy || expenses === null}
            onClick={async () => {
              if (!day) return;
              setBusy(true);
              try {
                await deleteProductionDay(day);
                onDeleted();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not delete");
              } finally {
                setBusy(false);
              }
            }}
          >
            {expenses?.length ? "Delete production and expenses" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
