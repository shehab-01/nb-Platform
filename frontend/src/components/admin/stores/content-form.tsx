"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resetStoreImage, uploadStoreImage, type StoreContent } from "@/lib/api";
import { templateInfo } from "@/templates/catalog";

/**
 * The pictures the store's template shows. Each starts as the template's
 * default; the owner can upload their own or go back to the default.
 */
export function ContentForm({
  storeId,
  initial,
}: {
  storeId: number;
  initial: StoreContent;
}) {
  const [state, setState] = React.useState(initial);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const info = templateInfo(state.template);

  const run = async (key: string, action: () => Promise<StoreContent>) => {
    setBusyKey(key);
    setError(null);
    try {
      setState(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyKey(null);
    }
  };

  if (info.content.length === 0) {
    return <p className="text-sm text-muted-foreground">This template has no replaceable pictures.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {info.content.map((field) => {
        const custom = state.content[field.key];
        const src = custom ?? field.defaultUrl;
        const busy = busyKey === field.key;
        return (
          <div key={field.key} className="flex items-center gap-4 rounded-lg border p-3">
            {/* Plain img: uploaded pictures come from /media and sizes vary. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={field.label}
              className="h-16 w-24 shrink-0 rounded bg-muted object-contain"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{field.label}</span>
                <Badge variant={custom ? "default" : "outline"}>{custom ? "Custom" : "Default"}</Badge>
              </div>
              <span className="text-xs text-muted-foreground">{field.size}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <label className="inline-flex">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void run(field.key, () => uploadStoreImage(storeId, field.key, file));
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={busy} asChild>
                  <span>{custom ? "Replace" : "Upload"}</span>
                </Button>
              </label>
              {custom && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(field.key, () => resetStoreImage(storeId, field.key))}
                >
                  Use default
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
