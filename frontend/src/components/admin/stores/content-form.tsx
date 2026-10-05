"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resetStoreImage, uploadStoreImage, type StoreContent } from "@/lib/api";
import { templateInfo } from "@/templates/catalog";
import { cn } from "@/lib/utils";

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
  const customCount = info.content.filter((field) => state.content[field.key]).length;

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
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
        <h2 className="text-sm font-semibold">Pictures</h2>
        <p className="text-xs text-muted-foreground">
          {customCount === 0 ? `Using default ${info.content[0].label.toLowerCase()}` : `${customCount} of ${info.content.length} customized`}
        </p>
      </div>
      <div className="flex flex-col px-5">
        {info.content.map((field, i) => {
          const custom = state.content[field.key];
          const src = custom ?? field.defaultUrl;
          const busy = busyKey === field.key;
          return (
            <div
              key={field.key}
              className={cn("flex flex-wrap items-center gap-4 py-4", i > 0 && "border-t")}
            >
              {/* Plain img: uploaded pictures come from /media and sizes vary. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={field.label}
                className="h-[58px] w-[130px] shrink-0 rounded-lg border bg-muted/30 object-contain"
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
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="px-5 pb-4 text-sm text-destructive">{error}</p>}
    </section>
  );
}
