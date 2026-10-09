"use client";

import * as React from "react";
import { useAuth } from "@/components/admin/auth-context";
import {
  getProductionSuggestions,
  listProductionItems,
  listProductionProducts,
  type ProductionItem,
  type ProductionProduct,
  type ProductionSuggestions,
} from "@/lib/api";

/** The Production Cost pages are CRM pages: super admins, and whoever a
 *  super admin gave CRM access in this store. Switching store starts the
 *  page over. */
export function CrmOnly({ children }: { children: React.ReactNode }) {
  const { store, can } = useAuth();
  if (!store || !can("crm")) {
    return (
      <p className="text-sm text-muted-foreground">
        The CRM is open to super admins and the people they give access to.
      </p>
    );
  }
  return <React.Fragment key={store.storeId}>{children}</React.Fragment>;
}

/** The store's products, raw-material items and other-cost purposes, as
 *  the entry form needs them; null until loaded. */
export function useProductionLists() {
  const [products, setProducts] = React.useState<ProductionProduct[] | null>(null);
  const [items, setItems] = React.useState<ProductionItem[] | null>(null);
  const [suggestions, setSuggestions] = React.useState<ProductionSuggestions>({ purposes: [] });
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([listProductionProducts(), listProductionItems(), getProductionSuggestions()])
      .then(([p, i, s]) => {
        if (cancelled) return;
        setProducts(p);
        setItems(i);
        setSuggestions(s);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  return { products, items, suggestions, setProducts, setItems, error };
}
