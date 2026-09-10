"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { useAuth } from "@/components/admin/auth-context";
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
import { listStores, type Store } from "@/lib/api";
import { templateInfo } from "@/templates/catalog";

/**
 * The platform's stores. Super admin only: creating a store, pointing domains
 * at it and choosing its template is nobody's job inside a store.
 */
export default function StoresPage() {
  const { isSuperAdmin } = useAuth();
  const [stores, setStores] = React.useState<Store[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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

  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Super admin only.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Every storefront on the platform, the domains it answers on and the
          template it renders with. Staff access is assigned under Users.
        </p>
        <Button size="sm" asChild>
          <Link href="/admin/stores/new">
            <Plus className="size-4" />
            New store
          </Link>
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
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Domains</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No stores yet.
                  </TableCell>
                </TableRow>
              )}
              {stores.map((store) => (
                <TableRow key={store.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{store.name}</span>
                      <span className="text-xs text-muted-foreground">{store.slug}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {store.domains.length === 0 && (
                        <span className="text-xs text-muted-foreground">none</span>
                      )}
                      {store.domains.map((d) => (
                        <Badge
                          key={d}
                          variant={d === store.primaryDomain ? "default" : "outline"}
                        >
                          {d}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{templateInfo(store.template).name}</TableCell>
                  <TableCell>{store.currency}</TableCell>
                  <TableCell>
                    <Badge variant={store.isActive ? "secondary" : "destructive"}>
                      {store.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/admin/stores/${store.id}`}>Edit</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

    </div>
  );
}
