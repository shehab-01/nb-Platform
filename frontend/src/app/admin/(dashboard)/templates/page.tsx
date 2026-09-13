"use client";

import Image from "next/image";
import * as React from "react";

import { useAuth } from "@/components/admin/auth-context";
import { TemplatePreview } from "@/components/admin/stores/template-preview";
import { Badge } from "@/components/ui/badge";
import { listStores, type Store } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TEMPLATE_CATALOG, resolveContent } from "@/templates/catalog";

/**
 * Every storefront template the platform can render, and which stores use
 * each: a list with a thumbnail per template, and the picked one rendered
 * live beside it — the same frame the store form shows, with the template's
 * default pictures and sample catalogue. A store picks its template on its
 * own page; adding a template is a folder under src/templates plus a
 * catalog entry.
 */
export default function TemplatesPage() {
  const { isSuperAdmin } = useAuth();
  const [stores, setStores] = React.useState<Store[]>([]);
  const templates = Object.values(TEMPLATE_CATALOG);
  const [selectedId, setSelectedId] = React.useState(templates[0]?.id ?? "classic");
  const selected = TEMPLATE_CATALOG[selectedId] ?? templates[0];
  // Stable per template: a new object each render would re-post the
  // pictures into the frame on every store list update.
  const previewContent = React.useMemo(() => resolveContent(selected.id, undefined), [selected.id]);

  React.useEffect(() => {
    if (isSuperAdmin) listStores().then(setStores).catch(() => {});
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }

  const usedBy = stores.filter((s) => s.template === selected.id);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="overflow-hidden rounded-xl border bg-card">
          <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
            <h1 className="text-sm font-semibold">Templates</h1>
            <span className="text-xs text-muted-foreground">
              {templates.length} available
            </span>
          </header>
          <ul role="listbox" aria-label="Templates">
            {templates.map((tpl) => {
              const users = stores.filter((s) => s.template === tpl.id);
              const active = tpl.id === selected.id;
              return (
                <li key={tpl.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(tpl.id)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0",
                      active ? "bg-primary/5" : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "relative h-16 w-12 shrink-0 overflow-hidden rounded-md border bg-muted",
                        active && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                      )}
                    >
                      {tpl.preview && (
                        <Image
                          src={tpl.preview}
                          alt=""
                          fill
                          sizes="48px"
                          className="object-cover object-top"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{tpl.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {tpl.id}
                      </span>
                    </span>
                    <Badge variant={users.length === 0 ? "outline" : "secondary"}>
                      {users.length === 0
                        ? "Unused"
                        : `${users.length} store${users.length === 1 ? "" : "s"}`}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">{selected.name}</h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">{selected.description}</p>
          <ul className="mt-3 flex flex-wrap gap-1">
            {selected.highlights.map((h) => (
              <li key={h}>
                <Badge variant="outline">{h}</Badge>
              </li>
            ))}
            {selected.singleVariant && (
              <li>
                <Badge variant="outline">Sells the default size only</Badge>
              </li>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {usedBy.length === 0
              ? "No store uses this template yet."
              : `Used by ${usedBy.map((s) => s.name).join(", ")}`}
          </p>
        </section>
      </div>

      <TemplatePreview
        template={selected.id}
        content={previewContent}
        className="lg:h-[calc(100vh-7rem)]"
      />
    </div>
  );
}
