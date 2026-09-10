"use client";

import * as React from "react";

import type { StorefrontListing } from "@/lib/products";
import { loadTemplate } from "@/templates";
import type { StorePublicConfig, TemplateModule } from "@/templates/types";

export const PREVIEW_MESSAGE = "nb-preview-content";

/**
 * The template, rendered live. The parent page (the store form) may post
 * `{type: "nb-preview-content", content: {key: url}}` to swap pictures before
 * anything is uploaded; blob: URLs from a same-origin parent load fine here.
 * Only same-origin messages are honoured.
 */
export function PreviewClient({
  templateName,
  store,
  listing,
}: {
  templateName: string;
  store: StorePublicConfig;
  listing: StorefrontListing | null;
}) {
  const [template, setTemplate] = React.useState<TemplateModule | null>(null);
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let live = true;
    loadTemplate(templateName).then((mod) => {
      if (live) setTemplate(mod);
    });
    return () => {
      live = false;
    };
  }, [templateName]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; content?: Record<string, string> };
      if (data?.type !== PREVIEW_MESSAGE || !data.content) return;
      setOverrides(data.content);
    };
    window.addEventListener("message", onMessage);
    // Tell the parent we can take pictures now (it may have picked some
    // before this frame loaded).
    window.parent?.postMessage({ type: `${PREVIEW_MESSAGE}-ready` }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!template) return null;
  const merged: StorePublicConfig = {
    ...store,
    content: { ...store.content, ...pick(overrides, Object.keys(store.content)) },
  };
  return (
    <div style={{ pointerEvents: "none" }} aria-hidden>
      {listing ? (
        <template.Storefront store={merged} listing={listing} />
      ) : (
        <template.Closed store={merged} />
      )}
    </div>
  );
}

function pick(from: Record<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (from[k]) out[k] = from[k];
  return out;
}
