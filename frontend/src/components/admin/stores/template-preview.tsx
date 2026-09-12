"use client";

import * as React from "react";

import { PREVIEW_MESSAGE } from "@/lib/preview-protocol";
import { cn } from "@/lib/utils";
import { templateInfo } from "@/templates/catalog";

/**
 * The template itself, rendered live beside the store form.
 *
 * Not a mock: the frame loads /preview, which renders the very components a
 * customer gets after the store is created, with a sample catalogue (or the
 * store's real one when `storeSlug` is given). Pictures are posted in rather
 * than put in the URL, so picking one swaps it in place — including the
 * blob: URL of a file that has not been uploaded yet — without reloading the
 * frame and losing the scroll position. Only the template can change the URL.
 */
export function TemplatePreview({
  template,
  /** An existing store's slug: shows its own catalogue and pictures. */
  storeSlug,
  /** Picture URL per content key: pending pick, existing upload, or the
      template default — see `resolveContent`. */
  content,
  className,
}: {
  template: string;
  storeSlug?: string;
  content: Record<string, string>;
  className?: string;
}) {
  const info = templateInfo(template);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = React.useState(true);
  // The store name only reaches the template as image alt text, so it is
  // deliberately not in the URL: typing it would reload the frame per key.
  const src = `/preview?template=${encodeURIComponent(template)}${
    storeSlug ? `&store=${encodeURIComponent(storeSlug)}` : ""
  }`;

  const post = React.useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, content },
      window.location.origin,
    );
  }, [content]);

  // Two ways in, because either side may be ready first: the frame says hello
  // when it mounts, and every later pick posts straight away.
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: string })?.type === `${PREVIEW_MESSAGE}-ready`) {
        setLoading(false);
        post();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post]);

  React.useEffect(post, [post]);

  return (
    <aside
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card xl:sticky xl:top-20",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{info.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{info.id}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Live preview
        </span>
      </div>
      <div className="relative min-h-[520px] flex-1 bg-[#eef1ea]">
        <iframe
          ref={frameRef}
          key={src}
          src={src}
          title={`${info.name} preview`}
          className="size-full border-0"
          onLoad={() => setLoading(false)}
        />
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-card text-xs text-muted-foreground">
            Loading preview…
          </div>
        )}
      </div>
      <p className="border-t px-4 py-3 text-xs leading-relaxed text-pretty text-muted-foreground">
        {info.description}
      </p>
    </aside>
  );
}
