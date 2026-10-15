"use client";

import { OrdersView } from "@/components/admin/orders/orders-view";

export default function IncompleteOrdersPage() {
  return (
    <OrdersView
      statusOptions={["incomplete"]}
      initialStatuses={["incomplete"]}
      storageKey="orders-incomplete"
      showStaff={false}
      showPreviousOrders
    />
  );
}
