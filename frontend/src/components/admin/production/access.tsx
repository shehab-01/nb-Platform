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

/** The Production pages open to production admins (PRODUCTION_ADMIN_EMAILS
 *  and super admins) and the people they chose to record productions in
 *  this store. Switching store starts the page over. */
export function ProductionOnly({ children }: { children: React.ReactNode }) {
  const { store, can } = useAuth();
  if (!store || !can("production")) {
    return (
      <p className="text-sm text-muted-foreground">
        Production is open to production admins and the people they choose.
      </p>
    );
  }
  return <React.Fragment key={store.storeId}>{children}</React.Fragment>;
}

/** For production admins only: correcting or deleting a saved production.
 *  The API refuses anyone else too; this only says so instead of a form. */
export function ProductionAdminOnly({ children }: { children: React.ReactNode }) {
  const { store, can } = useAuth();
  if (!store || !can("production.admin")) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a production admin can change a saved production.
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
