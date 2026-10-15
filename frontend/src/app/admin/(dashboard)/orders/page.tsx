"use client";

import { OrdersView } from "@/components/admin/orders/orders-view";
import { WEB_ORDER_STATUSES } from "@/lib/orders";

export default function WebOrderListsPage() {
  return (
    <OrdersView
      statusOptions={WEB_ORDER_STATUSES}
      initialStatuses={WEB_ORDER_STATUSES}
      storageKey="orders"
      showStaff={false}
      showPreviousOrders
    />
  );
}
