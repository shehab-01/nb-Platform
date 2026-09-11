"use client";

import * as React from "react";
import {
  Archive,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  Send,
  Truck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Order } from "@/lib/orders";
import type { StickerSize } from "@/lib/stickers";
import { cn } from "@/lib/utils";

/** Which bulk actions a list offers: the Confirm list hands orders to
 * shipping; the Ship list books them with the courier and prints stickers;
 * the History list offers the same courier/print actions without Send to
 * History — an archived order has nowhere further to be archived to. */
export type BulkMode = "confirm" | "ship" | "history";

export type BulkHandlers = {
  sendToShipping: (orders: Order[]) => Promise<void>;
  sendToPathao: (orders: Order[]) => Promise<void>;
  refreshPathao: (orders: Order[]) => Promise<void>;
  printStickers: (orders: Order[], size: StickerSize) => Promise<void>;
  sendToHistory: (orders: Order[]) => Promise<void>;
};

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Icon className="size-4" />
      {children}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
  busy,
  primary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors",
        "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        primary && "border-primary/40 bg-primary/5 hover:bg-primary/10"
      )}
    >
      {busy ? (
        <Loader2 className="size-4 shrink-0 animate-spin" />
      ) : (
        <Icon className="size-4 shrink-0" />
      )}
      <span className="flex-1">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  );
}

/**
 * The floating panel that appears while rows are ticked. Drops down from the
 * table header, over the top rows, so it sits next to the ticks that opened it.
 */
export function OrderBulkActions({
  mode,
  rows,
  clear,
  selectAllPage,
  allPageSelected,
  handlers,
}: {
  mode: BulkMode;
  rows: Order[];
  clear: () => void;
  selectAllPage: () => void;
  allPageSelected: boolean;
  handlers: BulkHandlers;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const unsent = rows.filter((order) => !order.pathaoConsignmentId);
  const booked = rows.filter((order) => order.pathaoConsignmentId);

  return (
    <div className="absolute left-1/2 top-[4.25rem] z-30 w-full max-w-sm -translate-x-1/2">
      <div className="rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl animate-in fade-in slide-in-from-top-2">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
            {rows.length} selected
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAllPage}
              disabled={allPageSelected}
            >
              <Check className="size-4" />
              Select all
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Clear selection"
              onClick={clear}
              disabled={busy !== null}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {mode === "confirm" && (
          <div className="mt-4 flex flex-col gap-2 border-t pt-4">
            <SectionTitle icon={Truck}>Status update</SectionTitle>
            <ActionButton
              icon={Truck}
              label="Send to Shipping"
              hint={`${rows.length} order${rows.length === 1 ? "" : "s"}`}
              primary
              busy={busy === "ship"}
              disabled={busy !== null}
              onClick={() => run("ship", () => handlers.sendToShipping(rows))}
            />
          </div>
        )}

        {(mode === "ship" || mode === "history") && (
          <>
            <div className="mt-4 flex flex-col gap-2 border-t pt-4">
              <SectionTitle icon={Send}>Courier services</SectionTitle>
              <ActionButton
                icon={Send}
                label="Send to Pathao"
                hint={
                  unsent.length === rows.length
                    ? undefined
                    : `${unsent.length} not sent yet`
                }
                primary
                busy={busy === "pathao"}
                disabled={busy !== null || unsent.length === 0}
                onClick={() => run("pathao", () => handlers.sendToPathao(unsent))}
              />
              <ActionButton
                icon={RefreshCw}
                label="Refresh status"
                hint={booked.length ? `${booked.length} booked` : undefined}
                busy={busy === "refresh"}
                disabled={busy !== null || booked.length === 0}
                onClick={() => run("refresh", () => handlers.refreshPathao(booked))}
              />
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t pt-4">
              <SectionTitle icon={Package}>Print</SectionTitle>
              <ActionButton
                icon={Package}
                label="Print stickers"
                hint={`${rows.length} × 3×4in`}
                busy={busy === "print"}
                disabled={busy !== null}
                onClick={() =>
                  run("print", () => handlers.printStickers(rows, "label"))
                }
              />
              <ActionButton
                icon={FileText}
                label="Print A4 invoices"
                hint={`${rows.length} page${rows.length === 1 ? "" : "s"}`}
                busy={busy === "print-a4"}
                disabled={busy !== null}
                onClick={() =>
                  run("print-a4", () => handlers.printStickers(rows, "a4"))
                }
              />
            </div>
            {mode === "ship" && (
              <div className="mt-4 flex flex-col gap-2 border-t pt-4">
                <SectionTitle icon={Archive}>Archive</SectionTitle>
                <ActionButton
                  icon={Archive}
                  label="Send to History"
                  hint={`${rows.length} order${rows.length === 1 ? "" : "s"}`}
                  busy={busy === "history"}
                  disabled={busy !== null}
                  onClick={() => run("history", () => handlers.sendToHistory(rows))}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export type BulkOutcome = {
  title: string;
  description?: string;
  /** Orders the action worked on, with what to show next to each. */
  done: { orderNo: string; detail?: string; href?: string }[];
  /** Orders it could not touch, with the reason. */
  failed: { orderNo: string; reason: string }[];
};

/** What happened to each order after a bulk action. */
export function BulkOutcomeDialog({
  outcome,
  onClose,
}: {
  outcome: BulkOutcome | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={outcome !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {outcome && (
          <>
            <DialogHeader>
              <DialogTitle>{outcome.title}</DialogTitle>
              {outcome.description && (
                <DialogDescription>{outcome.description}</DialogDescription>
              )}
            </DialogHeader>
            <div className="flex max-h-[60svh] flex-col gap-4 overflow-y-auto text-sm">
              {outcome.done.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {outcome.done.map((item) => (
                    <li
                      key={item.orderNo}
                      className="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Check className="size-4" />
                        {item.orderNo}
                      </span>
                      {item.href ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs underline underline-offset-2"
                        >
                          {item.detail}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        item.detail && (
                          <span className="text-xs text-muted-foreground">
                            {item.detail}
                          </span>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {outcome.failed.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {outcome.failed.map((item) => (
                    <li
                      key={item.orderNo}
                      className="rounded-md bg-red-50 px-3 py-2 text-red-900 dark:bg-red-950/40 dark:text-red-200"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <X className="size-4" />
                        {item.orderNo}
                      </span>
                      <p className="mt-0.5 pl-6 text-xs">{item.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
