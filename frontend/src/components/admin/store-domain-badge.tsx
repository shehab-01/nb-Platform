"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";

import { useAuth } from "@/components/admin/auth-context";
import { DomainStatusPill } from "@/components/admin/stores/domain-status";
import { getStoreHealth, type DomainHealth } from "@/lib/api";

/**
 * The current store's address in the top bar, and whether it is actually
 * serving. Staff work all day inside the admin without ever loading the
 * storefront, so a domain that stopped answering — DNS moved, certificate
 * expired — otherwise goes unnoticed until a customer says so.
 *
 * The probe is the same one the Stores list uses (GET /api/stores/{id}/health,
 * open to the store's own members), which reports the hostname alongside its
 * status — so this needs no separate lookup to know what to show. Answers are
 * cached for a minute on the API; clicking the pill forces a fresh check.
 */
export function StoreDomainBadge() {
  const { store } = useAuth();
  const storeId = store?.storeId ?? null;
  const [domain, setDomain] = React.useState<DomainHealth | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  const check = React.useCallback(
    async (id: number, refresh = false) => {
      setLoading(true);
      setError(undefined);
      try {
        const health = await getStoreHealth(id, refresh);
        // The store's own address: its primary domain, else whatever it has.
        setDomain(health.domains.find((d) => d.isPrimary) ?? health.domains[0] ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Check failed");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // After paint, not before: the header must never wait on a network probe.
  React.useEffect(() => {
    setDomain(null);
    if (storeId !== null) void check(storeId);
  }, [storeId, check]);

  if (storeId === null || (!loading && !error && !domain)) return null;

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      {domain && (
        <a
          href={`https://${domain.host}`}
          target="_blank"
          rel="noreferrer noopener"
          title={`Open https://${domain.host}`}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground"
        >
          {/* Brackets, not a border: they frame the address without adding
              another box to a bar that already has several. */}
          <span className="text-muted-foreground/40 select-none">[</span>
          {domain.host}
          <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
          <span className="text-muted-foreground/40 select-none">]</span>
        </a>
      )}
      <button
        type="button"
        title="Check again"
        disabled={loading}
        onClick={() => storeId !== null && void check(storeId, true)}
        className="cursor-pointer disabled:cursor-default"
      >
        <DomainStatusPill
          health={domain ?? undefined}
          loading={loading}
          error={error}
          dotOnly
        />
      </button>
    </div>
  );
}
