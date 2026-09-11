"use client";

import { OrdersView } from "@/components/admin/orders/orders-view";

/**
 * The archive: finished orders moved off the Shipping list by hand, so that
 * list only ever shows parcels still in flight.
 *
 * Fulfilment columns stay on — whether a sticker was printed and what Pathao
 * last said is exactly what anyone looking back at an old order wants to see.
 */
export default function HistoryOrdersPage() {
  return (
    <OrdersView
      statusOptions={["history"]}
      initialStatuses={["history"]}
      storageKey="orders-history"
      showFulfilment
      bulkActions="history"
    />
  );
}
