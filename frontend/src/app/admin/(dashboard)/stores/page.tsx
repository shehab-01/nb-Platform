"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, RotateCw } from "lucide-react";

import { useAuth } from "@/components/admin/auth-context";
import { DomainStatusPill } from "@/components/admin/stores/domain-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  archiveStore,
  getStoreHealth,
  listStores,
  restoreStore,
  type Store,
  type StoreHealth,
} from "@/lib/api";
import { storeTitle } from "@/lib/admin-store";
import { templateInfo } from "@/templates/catalog";

/**
 * The platform's stores. Super admin only: creating a store, pointing domains
 * at it and choosing its template is nobody's job inside a store.
 */
export default function StoresPage() {
  const { isSuperAdmin } = useAuth();
  const router = useRouter();
  const [stores, setStores] = React.useState<Store[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Is the domain actually serving? Probed per store, after the table is on
  // screen: each one is a real HTTPS request over the public internet, and
  // opening this page must not wait on them.
  const [health, setHealth] = React.useState<Record<number, StoreHealth>>({});
  const [probing, setProbing] = React.useState<Record<number, boolean>>({});
  const [probeError, setProbeError] = React.useState<Record<number, string>>({});

  const probe = React.useCallback(async (storeId: number, force = false) => {
    setProbing((p) => ({ ...p, [storeId]: true }));
    setProbeError((e) => {
      const next = { ...e };
      delete next[storeId];
      return next;
    });
    try {
      const result = await getStoreHealth(storeId, force);
      setHealth((h) => ({ ...h, [storeId]: result }));
    } catch (err) {
      setProbeError((e) => ({
        ...e,
        [storeId]: err instanceof Error ? err.message : "Check failed",
      }));
    } finally {
      setProbing((p) => ({ ...p, [storeId]: false }));
    }
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      setStores(await listStores());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isSuperAdmin) void refresh();
  }, [isSuperAdmin, refresh]);

  // Archived stores leave the main table for their own list below it.
  const live = React.useMemo(() => stores.filter((s) => !s.archivedAt), [stores]);
  const archived = React.useMemo(() => stores.filter((s) => s.archivedAt), [stores]);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  const archive = async (store: Store) => {
    const ok = window.confirm(
      `Archive ${storeTitle(store)}? It leaves the store list and staff can no longer be assigned to it. ` +
        "Nothing is deleted: orders, products and customers are kept, and you can restore it from the Archived list."
    );
    if (!ok) return;
    setBusyId(store.id);
    try {
      await archiveStore(store.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive store");
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (store: Store) => {
    setBusyId(store.id);
    try {
      await restoreStore(store.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore store");
    } finally {
      setBusyId(null);
    }
  };

  // One probe per store, in parallel, once the list is here. Stores with no
  // domain have nothing to check, and archived ones serve nothing.
  React.useEffect(() => {
    for (const store of live) {
      if (store.primaryDomain) void probe(store.id);
    }
  }, [live, probe]);

  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Every storefront on the platform, the domains it answers on and the
          template it renders with. <strong className="font-medium">Serving</strong> is a
          live check of the domain itself; <strong className="font-medium">Status</strong> is
          what this store&apos;s own row says. Staff access is assigned under Users.
        </p>
        {/* Not asChild+Link: the global anchor colour would override the
            button's text colour and hide the label. */}
        <Button size="sm" onClick={() => router.push("/admin/stores/new")}>
          <Plus className="size-4" />
          New store
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading stores…</p>
      ) : (
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead>Domains</TableHead>
                  <TableHead>Serving</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {live.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground"
                    >
                      No stores yet.
                    </TableCell>
                  </TableRow>
                )}
                {live.map((store) => (
                  <TableRow key={store.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{storeTitle(store)}</span>
                        <span className="text-xs text-muted-foreground">
                          {store.slug}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {store.domains.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            none
                          </span>
                        )}
                        {store.domains.map((d) => (
                          <a
                            key={d}
                            href={`https://${d}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 no-underline"
                            title={`Open https://${d}`}
                          >
                            <Badge
                              variant={
                                d === store.primaryDomain ? "default" : "outline"
                              }
                            >
                              {d}
                              <ExternalLink className="size-3 opacity-70" />
                            </Badge>
                          </a>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {store.primaryDomain ? (
                        <div className="flex items-center gap-1">
                          <DomainStatusPill
                            health={health[store.id]?.domains.find(
                              (d) => d.host === store.primaryDomain
                            )}
                            loading={probing[store.id] ?? false}
                            error={probeError[store.id]}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            aria-label={`Re-check ${store.primaryDomain}`}
                            title="Check again"
                            disabled={probing[store.id]}
                            onClick={() => void probe(store.id, true)}
                          >
                            <RotateCw className="size-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          no domain
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{templateInfo(store.template).name}</TableCell>
                    <TableCell>{store.currency}</TableCell>
                    <TableCell>
                      <Badge
                        variant={store.isActive ? "secondary" : "destructive"}
                      >
                        {store.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {/* Only an inactive store can be archived: switching it
                            off first is the deliberate step that stops sales.
                            Shown on every row so the option is findable; the
                            wrapper carries the hint, a disabled button can't. */}
                        <span
                          title={
                            store.isActive
                              ? "Switch this store off (Edit → Active) before archiving it"
                              : "Archive this store"
                          }
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            disabled={store.isActive || busyId === store.id}
                            onClick={() => void archive(store)}
                          >
                            Archive
                          </Button>
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/admin/stores/${store.id}`)}
                        >
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {!loading && archived.length > 0 && (
        <section className="rounded-xl border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Archived</h2>
            <p className="text-xs text-muted-foreground">
              Kept with all their orders and products. Restoring brings a store
              back inactive; switch it on from Edit when it should sell again.
            </p>
          </div>
          <ul className="divide-y">
            {archived.map((store) => (
              <li key={store.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{storeTitle(store)}</span>
                  <span className="text-xs text-muted-foreground">
                    {store.slug}
                    {store.archivedAt &&
                      ` · archived ${new Date(store.archivedAt).toLocaleDateString()}`}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === store.id}
                  onClick={() => void restore(store)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
