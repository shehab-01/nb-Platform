"use client";

import StockView, { StockOnly } from "@/components/admin/stock/stock-view";

/** Stock: packets in hand, for stores that keep stock (stores.stock_enabled). */
export default function StockPage() {
  return (
    <StockOnly>
      <StockView />
    </StockOnly>
  );
}
