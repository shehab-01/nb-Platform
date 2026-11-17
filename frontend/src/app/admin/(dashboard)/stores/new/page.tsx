"use client";

import * as React from "react";

import { useAuth } from "@/components/admin/auth-context";
import { StoreForm } from "@/components/admin/stores/store-form";
import { createStore, listStores, listTemplates, type Store } from "@/lib/api";

export default function NewStorePage() {
  const { isSuperAdmin, refreshStores } = useAuth();
  const [templates, setTemplates] = React.useState<string[]>(["classic"]);
  const [stores, setStores] = React.useState<Store[]>([]);

  React.useEffect(() => {
    if (!isSuperAdmin) return;
    listTemplates().then(setTemplates).catch(() => {});
    listStores().then(setStores).catch(() => {});
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }
  return (
    <StoreForm
      store={null}
      templates={templates}
      allStores={stores}
      onSave={async (input) => {
        const saved = await createStore(input);
        // So the new store is in the switcher straight away.
        await refreshStores();
        return saved;
      }}
    />
  );
}
