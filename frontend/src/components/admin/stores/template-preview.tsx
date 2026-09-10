"use client";

import * as React from "react";

import { PREVIEW_MESSAGE } from "@/app/preview/preview-client";
import { templateInfo } from "@/templates/catalog";

/**
 * The template rendered for real, in a phone-sized frame beside the store
 * form. Sample data until the store exists; the store's live catalogue after.
 * The name is debounced so typing does not reload the frame per keystroke.
 */
export function TemplatePreview({
  template,
  name,
  storeSlug,
  content,
}: {
  template: string;
  name: string;
  storeSlug?: string;
  /** Pictures picked but not uploaded yet, as object URLs by content key. */
  content?: Record<string, string>;
}) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [debouncedName, setDebouncedName] = React.useState(name);

  // Push the picked pictures into the frame: whenever they change, and again
  // when a freshly loaded frame says it is ready.
  const post = React.useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, content: content ?? {} },
      window.location.origin,
    );
  }, [content]);
  React.useEffect(post, [post]);
  React.useEffect(() => {
    const onReady = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === `${PREVIEW_MESSAGE}-ready`) post();
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [post]);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedName(name), 400);
    return () => clearTimeout(t);
  }, [name]);

  const params = new URLSearchParams({ template, name: debouncedName });
  if (storeSlug) params.set("store", storeSlug);
  const src = `/preview?${params.toString()}`;
  const info = templateInfo(template);

  return (
    <aside className="flex flex-col gap-2 lg:sticky lg:top-20">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">{info.name}</p>
        <p className="text-xs text-muted-foreground">
          {storeSlug ? "Live data" : "Sample data"}
        </p>
      </div>
      <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[2rem] border-8 border-foreground/90 bg-background shadow-xl">
        <iframe
          ref={frame}
          key={src}
          src={src}
          title={`${info.name} preview`}
          className="block h-[760px] w-full bg-white"
          sandbox="allow-same-origin allow-scripts"
        />
      </div>
      <p className="text-xs text-muted-foreground">{info.description}</p>
    </aside>
  );
}
