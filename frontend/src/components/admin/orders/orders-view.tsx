"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { getOrderColumns } from "@/components/admin/orders/columns";
import { OrderDetailsModal } from "@/components/admin/orders/order-details-modal";
import {
  BulkOutcomeDialog,
  OrderBulkActions,
  type BulkHandlers,
  type BulkMode,
  type BulkOutcome,
} from "@/components/admin/orders/order-bulk-actions";
import {
  DataTable,
  type DataTableQuery,
  type SelectionContext,
} from "@/components/admin/data-table/data-table";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/admin/auth-context";
import {
  bulkUpdateOrders,
  claimOrder,
  listClaims,
  listOrders,
  refreshPathao,
  releaseOrder,
  releaseOrderOnLeave,
  sendToPathao,
  type Claim,
  type OrderListParams,
} from "@/lib/api";
import { printStickers } from "@/lib/stickers";
import {
  ORDER_SOURCE_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  STATUS_PAGES,
  activeClaim,
  staffLabel,
  type OrderSource,
  type OrderStatus,
  type Order,
} from "@/lib/orders";
import { notifyOrdersChanged } from "@/lib/use-order-counts";

/** How often to ask who holds what. Tiny request, so this can be quick. */
const CLAIMS_POLL_MS = 2_000;
/** How often an open modal renews its claim. */
const HEARTBEAT_MS = 60_000;

const SORT_FIELDS: Record<string, string> = {
  id: "id",
  total: "total",
  createdAt: "created_at",
};

function queryToParams(
  query: DataTableQuery,
  scope: OrderStatus[]
): OrderListParams {
  const params: OrderListParams = {
    page: query.pagination.pageIndex + 1,
    pageSize: query.pagination.pageSize,
    // A page never reaches outside its own statuses, even with the status
    // filter cleared — otherwise clearing it would show every order here.
    status: scope,
  };
  for (const filter of query.columnFilters) {
    if (filter.id === "status") {
      const picked = (filter.value as OrderStatus[]).filter((status) =>
        scope.includes(status)
      );
      if (picked.length) params.status = picked;
    } else if (filter.id === "source") {
      const picked = filter.value as OrderSource[];
      if (picked.length) params.source = picked;
    } else if (filter.id === "customerName") {
      const q = String(filter.value).trim();
      if (q) params.q = q;
    } else if (filter.id === "createdAt") {
      const range = filter.value as { from?: string; to?: string };
      if (range.from) params.dateFrom = range.from;
      if (range.to) params.dateTo = range.to;
    }
  }
  const sort = query.sorting[0];
  if (sort && SORT_FIELDS[sort.id]) {
    params.sort = `${sort.desc ? "-" : ""}${SORT_FIELDS[sort.id]}`;
  }
  return params;
}

export function OrdersView({
  statusOptions,
  initialStatuses,
  storageKey,
  showFulfilment = false,
  showStaff = true,
  bulkActions,
}: {
  /** Which statuses the filter offers on this page. */
  statusOptions: OrderStatus[];
  /** Which of them are selected by default. */
  initialStatuses: OrderStatus[];
  /** Where this page remembers its saved column layout. */
  storageKey: string;
  /**
   * Show Print and Courier by default. They only mean anything once an order
   * is going out the door, so only the fulfilment lists switch them on —
   * everywhere else they stay one toggle away in the View panel.
   */
  showFulfilment?: boolean;
  /**
   * Show the Staff column by default. Lists of orders nobody has worked yet —
   * new web orders, captured forms — would show an empty column, so they turn
   * it off; it stays available in the View panel.
   */
  showStaff?: boolean;
  /**
   * Which bulk actions ticking rows offers. "confirm" sends the batch on to
   * Shipping; "ship" books it with Pathao and prints stickers. Omit for
   * lists that only ever work one order at a time.
   */
  bulkActions?: BulkMode;
}) {
  const { user } = useAuth();
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [total, setTotal] = React.useState(0);
  const [pages, setPages] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState<DataTableQuery | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [selectedOrder, setSelectedOrder] = React.useState<Order | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [moved, setMoved] = React.useState<{
    orderNo: string;
    status: OrderStatus;
  } | null>(null);
  // "X is working on this order" when a claim is refused.
  const [notice, setNotice] = React.useState<string | null>(null);
  // Per-order report after a bulk action.
  const [outcome, setOutcome] = React.useState<BulkOutcome | null>(null);
  // The open order and modal state, readable from timers and unload handlers
  // without stale closures.
  const selectedRef = React.useRef<Order | null>(null);
  selectedRef.current = selectedOrder;
  const modalOpenRef = React.useRef(false);
  modalOpenRef.current = modalOpen;
  // A claims poll that started before our own claim/release finished would
  // carry the old picture; anything started before this moment is ignored.
  const claimEpochRef = React.useRef(0);
  // Last time the server answered. If that's older than the claim TTL while
  // the modal is open, the hold is gone and the modal must not pretend.
  const lastServerOkRef = React.useRef(Date.now());
  const claimTtlMsRef = React.useRef(10 * 60_000);

  // Pages pass array literals, so pin the identity to the contents.
  const scopeKey = statusOptions.join(",");
  const scope = React.useMemo(
    () => scopeKey.split(",") as OrderStatus[],
    [scopeKey]
  );

  const lastSearch = React.useRef<string | undefined>(undefined);
  const silentRef = React.useRef(false);

  // Live view: refresh every 10s while the tab is visible, and on refocus,
  // so changes made by other workers show up without anyone reloading.
  React.useEffect(() => {
    const silentRefresh = () => {
      if (document.visibilityState !== "visible") return;
      silentRef.current = true;
      setRefreshKey((k) => k + 1);
    };
    const interval = setInterval(silentRefresh, 10_000);
    document.addEventListener("visibilitychange", silentRefresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", silentRefresh);
    };
  }, []);

  React.useEffect(() => {
    if (!query) return;
    const params = queryToParams(query, scope);
    const searchChanged = params.q !== lastSearch.current;
    lastSearch.current = params.q;

    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    const run = async () => {
      if (!silent) setLoading(true);
      try {
        const result = await listOrders(params);
        if (cancelled) return;
        setOrders(result.items);
        setTotal(result.total);
        setPages(result.pages);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load orders");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Debounce keystrokes in the search box; everything else fetches at once.
    const timer = setTimeout(run, searchChanged ? 350 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, refreshKey, scope]);

  const patchRow = React.useCallback((updated: Order) => {
    setOrders((prev) =>
      prev.map((order) => (order.id === updated.id ? updated : order))
    );
  }, []);

  // Opening an order claims it first. While the claim holds, everyone else
  // sees the lock instead of an Open button.
  const handleOpen = React.useCallback(
    async (order: Order) => {
      setMoved(null);
      setNotice(null);
      try {
        const claimed = await claimOrder(order.id);
        claimEpochRef.current = Date.now();
        lastServerOkRef.current = Date.now();
        patchRow(claimed);
        setSelectedOrder(claimed);
        setModalOpen(true);
      } catch (err) {
        setNotice(
          err instanceof Error ? err.message : "Could not open this order"
        );
        // Show the lock straight away rather than on the next poll.
        silentRef.current = true;
        setRefreshKey((k) => k + 1);
      }
    },
    [patchRow]
  );

  // Give the order back when the modal closes without moving it. After a
  // status change the server has already cleared the claim, so this is a
  // no-op then.
  const releaseIfMine = React.useCallback(
    (order: Order | null) => {
      if (!order || order.assignedToId !== user.id) return;
      releaseOrder(order.id)
        .then((released) => {
          claimEpochRef.current = Date.now();
          patchRow(released);
        })
        .catch(() => {
          // Already released or expired; the next poll shows the truth.
        });
    },
    [user.id, patchRow]
  );

  const handleModalOpenChange = React.useCallback(
    (open: boolean) => {
      setModalOpen(open);
      if (!open) releaseIfMine(selectedRef.current);
    },
    [releaseIfMine]
  );

  const loseHold = React.useCallback((message: string) => {
    setModalOpen(false);
    setNotice(message);
  }, []);

  // Keep the claim fresh while the modal is open (a long phone call must not
  // look like a dead tab), and let go if the tab closes with it open. If the
  // server says the hold is gone — the laptop slept past the TTL and someone
  // else opened the order — close the modal rather than let stale work go on.
  React.useEffect(() => {
    if (!modalOpen) return;
    const heartbeat = () => {
      const current = selectedRef.current;
      if (!current || current.assignedToId !== user.id) return;
      claimOrder(current.id)
        .then((claimed) => {
          lastServerOkRef.current = Date.now();
          patchRow(claimed);
        })
        .catch((err) => {
          if (err instanceof Error && /handling/.test(err.message)) {
            loseHold(`Your hold on #${current.orderNo} ended — ${err.message}.`);
          }
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") heartbeat();
    };
    const timer = setInterval(heartbeat, HEARTBEAT_MS);
    const onLeave = () => {
      const current = selectedRef.current;
      if (current && current.assignedToId === user.id) {
        releaseOrderOnLeave(current.id);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onLeave);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [modalOpen, user.id, patchRow, loseHold]);

  // Fast lock poll: who holds what, every couple of seconds, merged into the
  // rows so a colleague's Open button turns into their name almost at once.
  const applyClaims = React.useCallback(
    (claims: Claim[], startedAt: number) => {
      if (startedAt < claimEpochRef.current) return;
      lastServerOkRef.current = Date.now();
      const byId = new Map(claims.map((claim) => [claim.id, claim]));
      setOrders((prev) => {
        let changed = false;
        const next = prev.map((order) => {
          const claim = byId.get(order.id);
          if (claim) {
            if (
              order.claimActive &&
              order.assignedToId === claim.assignedToId &&
              order.assignedAt === claim.assignedAt
            ) {
              return order;
            }
            changed = true;
            return {
              ...order,
              assignedToId: claim.assignedToId,
              assignedToName: claim.assignedToName,
              assignedToNickname: claim.assignedToNickname,
              assignedAt: claim.assignedAt,
              claimActive: true,
            };
          }
          if (order.claimActive || order.assignedToId !== null) {
            changed = true;
            return {
              ...order,
              assignedToId: null,
              assignedToName: null,
              assignedToNickname: null,
              assignedAt: null,
              claimActive: false,
            };
          }
          return order;
        });
        return changed ? next : prev;
      });

      const current = selectedRef.current;
      if (modalOpenRef.current && current) {
        const claim = byId.get(current.id);
        if (!claim) {
          loseHold(`Your hold on #${current.orderNo} ended.`);
        } else if (claim.assignedToId !== user.id) {
          loseHold(
            `Your hold on #${current.orderNo} ended — ${staffLabel(claim.assignedToName, claim.assignedToNickname)} is handling it now.`
          );
        }
      }
    },
    [user.id, loseHold]
  );

  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const startedAt = Date.now();
      try {
        const result = await listClaims();
        if (cancelled) return;
        claimTtlMsRef.current = result.ttlSeconds * 1000;
        applyClaims(result.claims, startedAt);
      } catch {
        // Can't reach the server. Past the TTL the hold is gone regardless,
        // so don't leave a modal open on a promise the server no longer keeps.
        const current = selectedRef.current;
        if (
          modalOpenRef.current &&
          current &&
          Date.now() - lastServerOkRef.current > claimTtlMsRef.current
        ) {
          loseHold(
            `Your hold on #${current.orderNo} ended — no connection to the server for ${Math.round(claimTtlMsRef.current / 60_000)} minutes.`
          );
        }
      }
    };
    tick();
    const timer = setInterval(tick, CLAIMS_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [applyClaims, loseHold]);

  const handleOrderUpdated = React.useCallback(
    (updated: Order) => {
      setSelectedOrder(updated);
      const stays = scope.includes(updated.status);
      if (stays) {
        setOrders((prev) =>
          prev.map((order) => (order.id === updated.id ? updated : order))
        );
      } else {
        // The new status belongs to another page: drop the row, close the
        // modal, and say where the order went.
        setOrders((prev) => prev.filter((order) => order.id !== updated.id));
        setModalOpen(false);
        setMoved({ orderNo: updated.orderNo, status: updated.status });
      }
      // Refetch so counts and any concurrent edits stay accurate.
      silentRef.current = true;
      setRefreshKey((k) => k + 1);
      notifyOrdersChanged();
    },
    [scope]
  );

  const refetch = React.useCallback(() => {
    silentRef.current = true;
    setRefreshKey((k) => k + 1);
    notifyOrdersChanged();
  }, []);

  const patchRows = React.useCallback((updated: Order[]) => {
    if (!updated.length) return;
    const byId = new Map(updated.map((order) => [order.id, order]));
    setOrders((prev) => prev.map((order) => byId.get(order.id) ?? order));
  }, []);

  const bulkHandlers = React.useMemo<BulkHandlers>(
    () => ({
      sendToShipping: async (rows) => {
        setMoved(null);
        setNotice(null);
        try {
          const result = await bulkUpdateOrders(
            rows.map((order) => order.id),
            { status: "shipped" }
          );
          const movedIds = new Set(result.updated.map((order) => order.id));
          setOrders((prev) => prev.filter((order) => !movedIds.has(order.id)));
          setOutcome({
            title: "Sent to Shipping",
            description: `${result.updated.length} of ${rows.length} order${
              rows.length === 1 ? "" : "s"
            } moved to the Shipping list.`,
            done: result.updated.map((order) => ({ orderNo: order.orderNo })),
            failed: result.skipped.map((item) => ({
              orderNo: item.orderNo,
              reason: item.reason,
            })),
          });
        } catch (err) {
          setNotice(err instanceof Error ? err.message : "Could not move orders");
        }
        refetch();
      },
      sendToPathao: async (rows) => {
        setNotice(null);
        try {
          const result = await sendToPathao(rows.map((order) => order.id));
          patchRows(result.orders);
          setOutcome({
            title: "Sent to Pathao",
            description: `${result.orders.length} of ${rows.length} parcel${
              rows.length === 1 ? "" : "s"
            } booked. Click a consignment id to open its tracking page.`,
            done: result.orders.map((order) => ({
              orderNo: order.orderNo,
              detail: order.pathaoConsignmentId ?? undefined,
              href: order.pathaoTrackingUrl ?? undefined,
            })),
            failed: result.failed.map((item) => ({
              orderNo: item.orderNo,
              reason: item.error,
            })),
          });
        } catch (err) {
          setNotice(err instanceof Error ? err.message : "Could not reach Pathao");
        }
        refetch();
      },
      refreshPathao: async (rows) => {
        setNotice(null);
        try {
          const result = await refreshPathao(rows.map((order) => order.id));
          patchRows(result.orders);
          if (result.failed.length) {
            setOutcome({
              title: "Pathao status",
              description: `${result.orders.length} refreshed, ${result.failed.length} failed.`,
              done: result.orders.map((order) => ({
                orderNo: order.orderNo,
                detail: order.pathaoStatus ?? undefined,
              })),
              failed: result.failed.map((item) => ({
                orderNo: item.orderNo,
                reason: item.error,
              })),
            });
          }
        } catch (err) {
          setNotice(err instanceof Error ? err.message : "Could not reach Pathao");
        }
      },
      sendToHistory: async (rows) => {
        setMoved(null);
        setNotice(null);
        try {
          const result = await bulkUpdateOrders(
            rows.map((order) => order.id),
            { status: "history" }
          );
          // Drop them from this list straight away rather than waiting for the
          // next poll — the whole point is that Shipping goes clear.
          const movedIds = new Set(result.updated.map((order) => order.id));
          setOrders((prev) => prev.filter((order) => !movedIds.has(order.id)));
          setOutcome({
            title: "Sent to History",
            description: `${result.updated.length} of ${rows.length} order${
              rows.length === 1 ? "" : "s"
            } archived.`,
            done: result.updated.map((order) => ({ orderNo: order.orderNo })),
            failed: result.skipped.map((item) => ({
              orderNo: item.orderNo,
              reason: item.reason,
            })),
          });
        } catch (err) {
          setNotice(err instanceof Error ? err.message : "Could not archive");
        }
      },
      printStickers: async (rows, size) => {
        setNotice(null);
        if (!printStickers(rows, size)) {
          setNotice("The browser blocked the print window. Allow pop-ups for this site and try again.");
          return;
        }
        try {
          const result = await bulkUpdateOrders(
            rows.map((order) => order.id),
            { printed: true }
          );
          patchRows(result.updated);
        } catch {
          // The stickers still printed; the tick catches up on the next poll.
        }
      },
    }),
    [patchRows, refetch]
  );

  const renderSelectionBar = React.useCallback(
    (ctx: SelectionContext<Order>) =>
      bulkActions ? (
        <OrderBulkActions
          mode={bulkActions}
          rows={ctx.rows}
          clear={ctx.clear}
          selectAllPage={ctx.selectAllPage}
          allPageSelected={ctx.allPageSelected}
          handlers={bulkHandlers}
        />
      ) : null,
    [bulkActions, bulkHandlers]
  );

  const rowId = React.useCallback((order: Order) => String(order.id), []);

  const columns = React.useMemo(
    () =>
      getOrderColumns({
        onOpen: handleOpen,
        onOrderUpdated: handleOrderUpdated,
        currentUserId: user.id,
      }),
    [handleOpen, handleOrderUpdated, user.id]
  );

  // Rows someone else is working on are tinted, not just badged.
  const rowClassName = React.useCallback(
    (order: Order) => {
      const claim = activeClaim(order);
      return claim && claim.id !== user.id
        ? "bg-amber-50/70 dark:bg-amber-950/20"
        : undefined;
    },
    [user.id]
  );

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <p>{notice}</p>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {moved && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/50 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          <p>
            Order <span className="font-medium">#{moved.orderNo}</span> is now{" "}
            <span className="font-medium">
              {ORDER_STATUS_LABELS[moved.status]}
            </span>{" "}
            and moved to{" "}
            <Link
              href={STATUS_PAGES[moved.status].href}
              className="font-medium underline underline-offset-2"
            >
              {STATUS_PAGES[moved.status].title}
            </Link>
            .
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-emerald-800 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
            aria-label="Dismiss"
            onClick={() => setMoved(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={orders}
        searchColumnId="customerName"
        searchPlaceholder="Search by name, phone, or order ID..."
        facetedFilters={[
          {
            columnId: "status",
            title: "Status",
            options: ORDER_STATUSES.filter((status) =>
              statusOptions.includes(status.value)
            ).map((status) => ({
              label: status.label,
              value: status.value,
            })),
          },
          // Every value the column can hold, not only the ones on this page:
          // the filter is a question ("which of these came in by hand?"), and
          // an empty answer is an answer.
          {
            columnId: "source",
            title: "Source",
            options: (Object.keys(ORDER_SOURCE_LABELS) as OrderSource[]).map(
              (source) => ({ label: ORDER_SOURCE_LABELS[source], value: source })
            ),
          },
        ]}
        dateFilter={{ columnId: "createdAt", title: "Date" }}
        initialColumnFilters={[{ id: "status", value: initialStatuses }]}
        getRowClassName={rowClassName}
        initialColumnVisibility={{
          status: false,
          staff: showStaff,
          printed: showFulfilment,
          courier: showFulfilment,
          pathao: showFulfilment,
          delivery: showFulfilment,
        }}
        storageKey={storageKey}
        getRowId={rowId}
        selectionBar={bulkActions ? renderSelectionBar : undefined}
        serverSide={{
          total,
          pages,
          loading,
          onQueryChange: setQuery,
        }}
      />

      <BulkOutcomeDialog outcome={outcome} onClose={() => setOutcome(null)} />

      <OrderDetailsModal
        order={selectedOrder}
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        onOrderUpdated={handleOrderUpdated}
      />
    </div>
  );
}
