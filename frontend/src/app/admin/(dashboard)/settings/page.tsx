"use client";

import * as React from "react";

import { useAuth } from "@/components/admin/auth-context";
import { ContentForm } from "@/components/admin/stores/content-form";
import { SettingsForm } from "@/components/admin/stores/settings-form";
import {
  getStoreContent,
  getStoreSettings,
  saveStoreSettings,
  type StoreContent,
  type StoreSettings,
} from "@/lib/api";

/** The selected store's integrations. Owners and super admins only. */
export default function StoreSettingsPage() {
  const { store, can } = useAuth();
  const [settings, setSettings] = React.useState<StoreSettings | null>(null);
  const [content, setContent] = React.useState<StoreContent | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const allowed = store !== null && can("settings");

  React.useEffect(() => {
    if (!allowed || !store) return;
    Promise.all([getStoreSettings(store.storeId), getStoreContent(store.storeId)])
      .then(([s, c]) => {
        setSettings(s);
        setContent(c);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [allowed, store]);

  if (!store) return <p className="text-sm text-muted-foreground">Select a store first.</p>;
  if (!allowed) return <p className="text-sm text-muted-foreground">Only the store owner can change settings.</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!settings || !content) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <ContentForm key={store.storeId} storeId={store.storeId} initial={content} />
      <SettingsForm
        key={store.storeId}
        storeId={store.storeId}
        settings={settings}
        onSave={(input) => saveStoreSettings(store.storeId, input)}
      />
    </div>
  );
}
