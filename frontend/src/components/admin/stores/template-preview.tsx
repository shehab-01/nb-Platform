"use client";

import { cn } from "@/lib/utils";
import { templateInfo } from "@/templates/catalog";

/**
 * A flat mock of the template's content slots beside the store form: the
 * logo in a dark header, each remaining picture in its own labelled box, an
 * order button at the bottom. Not the rendered storefront — just the
 * pictures the store can replace, so a pick shows up here immediately
 * through `content` without waiting on a real page load.
 */
export function TemplatePreview({
  template,
  /** Picture URL per content key: pending pick, existing upload, or the
      template default — see `resolveContent`. */
  content,
}: {
  template: string;
  content: Record<string, string>;
}) {
  const info = templateInfo(template);
  const [logo, ...sections] = info.content;

  return (
    <aside className="flex flex-col gap-2 lg:sticky lg:top-20">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">{info.name}</p>
        <p className="text-xs text-muted-foreground">Preview</p>
      </div>
      <div className="overflow-hidden rounded-xl border bg-background">
        {logo && (
          <div className="flex items-center justify-center bg-[#123324] p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={content[logo.key]} alt={logo.label} className="h-11 max-w-[150px] object-contain" />
          </div>
        )}
        {sections.map((slot, i) => (
          <div key={slot.key} className={cn("p-4", i % 2 ? "bg-muted/30" : "bg-background", (logo || i > 0) && "border-t")}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {slot.label}
              </p>
              <p className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{slot.size}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={content[slot.key]}
              alt={slot.label}
              className="h-24 w-full rounded-lg border border-dashed object-cover"
            />
          </div>
        ))}
        <div className="flex justify-center bg-[#123324] p-5">
          <span className="rounded-lg bg-background px-8 py-2.5 text-sm font-bold text-[#123324]">
            অর্ডার করুন
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{info.description}</p>
    </aside>
  );
}
