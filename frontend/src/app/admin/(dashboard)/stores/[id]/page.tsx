"use client";

import * as React from "react";
import { useParams } from "next/navigation";

import { useAuth } from "@/components/admin/auth-context";
import { StoreForm } from "@/components/admin/stores/store-form";
import {
  getStoreContent,
  listStores,
  listTemplates,
  updateStore,
  type Store,
} from "@/lib/api";

export default function EditStorePage() {
  const { isSuperAdmin } = useAuth();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [store, setStore] = React.useState<Store | null>(null);
  const [all, setAll] = React.useState<Store[]>([]);
  const [templates, setTemplates] = React.useState<string[]>(["classic"]);
  const [pictures, setPictures] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isSuperAdmin) return;
    Promise.all([listStores(), listTemplates(), getStoreContent(id)])
      .then(([stores, names, content]) => {
        const found = stores.find((s) => s.id === id) ?? null;
        if (!found) setError("Store not found");
        setStore(found);
        setAll(stores);
        setTemplates(names);
        setPictures(content.content);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [isSuperAdmin, id]);

  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!store) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <StoreForm
      key={store.id}
      store={store}
      templates={templates}
      allStores={all}
      existingPictures={pictures}
      onSave={(input) => updateStore(store.id, input)}
    />
  );
}
