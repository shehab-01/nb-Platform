"use client";

import { FileWarning, History, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { PhoneLookup } from "@/lib/api";
import {
  ORDER_STATUS_LABELS,
  STATUS_BADGE_CLASS,
  courierLabel,
  courierStatusLabel,
  formatOrderDateTime,
  type Order,
} from "@/lib/orders";
import { cn } from "@/lib/utils";

function OrderRow({
  order,
  onOpen,
}: {
  order: Order;
  onOpen: (order: Order) => void;
}) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Opens a read-only modal rather than linking to the order's list
            page: navigating away would abandon the half-typed order the staff
            member is in the middle of taking. */}
        <button
          type="button"
          onClick={() => onOpen(order)}
          className="rounded font-mono text-sm font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {order.orderNo}
        </button>
        <Badge
          variant="secondary"
          className={cn("font-medium", STATUS_BADGE_CLASS[order.status])}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatOrderDateTime(order.createdAt)}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          ৳ {order.total}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {order.items.length > 0
          ? order.items
              .map((item) => `${item.productName} × ${item.quantity}`)
              .join(", ")
          : `${order.product} × ${order.quantity}`}
      </div>
      {order.courierStatus && (
        <div className="mt-1 text-xs text-muted-foreground">
          {courierLabel(order)}: {courierStatusLabel(order.courierStatus)}
          {order.courierConsignmentId ? ` · ${order.courierConsignmentId}` : ""}
        </div>
      )}
    </li>
  );
}

/**
 * What this number has done before, shown while staff take a new order.
 *
 * Purely informational and deliberately not a blocker: it exists so whoever is
 * on the phone can say "that one is already shipping" rather than quietly
 * taking a duplicate. Placing another order stays one click away.
 *
 * Placed orders and abandoned forms are shown apart on purpose — they mean
 * opposite things on a call. An order is something to explain the status of;
 * an abandoned form is a customer who never ordered at all, so telling them
 * "you already ordered this" would simply be wrong.
 */
export function PreviousOrders({
  lookup,
  loading,
  searched,
  onOpen,
}: {
  lookup: PhoneLookup;
  loading: boolean;
  /** True once a complete number has actually been looked up. */
  searched: boolean;
  /** Show this order's full details, without leaving the page. */
  onOpen: (order: Order) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Checking previous orders…
      </div>
    );
  }

  if (!searched) return null;

  const { orders, incomplete } = lookup;

  if (orders.length === 0 && incomplete.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        No previous orders or abandoned forms for this number.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {orders.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex items-center gap-2 border-b border-amber-300 px-4 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:text-amber-200">
            <History className="size-4" />
            {orders.length} previous order{orders.length === 1 ? "" : "s"} from
            this number
          </div>
          <ul className="divide-y divide-amber-200 dark:divide-amber-900">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}

      {incomplete.length > 0 && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex items-start gap-2 border-b border-slate-300 px-4 py-2.5 dark:border-slate-700">
            <FileWarning className="mt-0.5 size-4 shrink-0 text-slate-600 dark:text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {incomplete.length} abandoned form
                {incomplete.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                This number filled in the storefront form but never submitted
                it — nothing was ordered.
              </p>
            </div>
          </div>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {incomplete.map((order) => (
              <OrderRow key={order.id} order={order} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
