"use client";

import Image from "next/image";
import * as React from "react";

import { useAuth } from "@/components/admin/auth-context";
import { Badge } from "@/components/ui/badge";
import { listStores, type Store } from "@/lib/api";
import { TEMPLATE_CATALOG } from "@/templates/catalog";

/**
 * Every storefront template the platform can render, and which stores use
 * each. A store picks one on its own page; adding a template is a folder
 * under src/templates plus a catalog entry.
 */
export default function TemplatesPage() {
  const { isSuperAdmin } = useAuth();
  const [stores, setStores] = React.useState<Store[]>([]);

  React.useEffect(() => {
    if (isSuperAdmin) listStores().then(setStores).catch(() => {});
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {Object.values(TEMPLATE_CATALOG).map((tpl) => {
        const users = stores.filter((s) => s.template === tpl.id);
        return (
          <article key={tpl.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
            <div className="relative aspect-[480/620] w-full overflow-hidden border-b bg-muted">
              {tpl.preview && (
                <Image
                  src={tpl.preview}
                  alt={`${tpl.name} preview`}
                  fill
                  sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover object-top"
                />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{tpl.name}</h2>
                  <p className="text-xs text-muted-foreground">{tpl.id}</p>
                </div>
                <Badge variant="secondary">
                  {users.length === 0
                    ? "Unused"
                    : `${users.length} store${users.length === 1 ? "" : "s"}`}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{tpl.description}</p>
              <ul className="flex flex-wrap gap-1">
                {tpl.highlights.map((h) => (
                  <li key={h}>
                    <Badge variant="outline">{h}</Badge>
                  </li>
                ))}
              </ul>
              {users.length > 0 && (
                <p className="mt-auto text-xs text-muted-foreground">
                  Used by {users.map((s) => s.name).join(", ")}
                </p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
