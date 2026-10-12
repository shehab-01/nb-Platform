"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { storeTitle } from "@/lib/admin-store";
import type { AccessPage } from "@/lib/api";
import { STORE_ROLE_LABELS, type TeamMember } from "@/lib/team";

const COPY: Record<AccessPage, { title: string; pick: string; admin: string }> = {
  expenses: {
    title: "Expenses",
    pick: "Tick the stores where this person may use Expenses: add expenses and edit their own. Their role in the store does not matter: an owner needs this too.",
    admin: "A super admin always has Expenses in every store; nothing to set here.",
  },
  production: {
    title: "Production",
    pick: "Tick the stores where this person may record productions. Their role in the store does not matter: an owner needs this too.",
    admin: "A super admin is a production admin in every store; nothing to set here.",
  },
};

/**
 * Where a person may use Expenses, or record productions. Neither is part
 * of any role — not even owner — so it is given here, store by store, and
 * only among the stores the person already belongs to (Assign stores comes
 * first). The CRM admins can also give it on those pages (Manage access).
 * Saving replaces the whole choice.
 */
export function CrmDialog({
  member,
  page,
  onOpenChange,
  onSave,
}: {
  member: TeamMember | null;
  page: AccessPage;
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, storeIds: number[]) => Promise<void>;
}) {
  const copy = COPY[page];
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (member) {
      setPicked(
        new Set(
          member.memberships
            .filter((m) => (page === "expenses" ? m.crm : m.production))
            .map((m) => m.storeId)
        )
      );
      setError(null);
    }
  }, [member, page]);

  if (!member) return null;
  const superAdmin = member.role === "super_admin";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(member.id, [...picked]);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {copy.title} for {member.nickname || member.name}
          </DialogTitle>
          <DialogDescription>{superAdmin ? copy.admin : copy.pick}
          </DialogDescription>
        </DialogHeader>

        {!superAdmin && (
          <div className="flex flex-col divide-y rounded-lg border">
            {member.memberships.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                Not in any store yet. Use Assign stores first; this can then be
                given in any of them.
              </p>
            )}
            {member.memberships.map((m) => (
              <label
                key={m.storeId}
                htmlFor={`${page}-${m.storeId}`}
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
              >
                <Checkbox
                  id={`${page}-${m.storeId}`}
                  checked={picked.has(m.storeId)}
                  onCheckedChange={(checked) => {
                    const next = new Set(picked);
                    if (checked) next.add(m.storeId);
                    else next.delete(m.storeId);
                    setPicked(next);
                  }}
                />
                <span className="flex flex-1 flex-col text-sm">
                  <span className="font-medium">{storeTitle(m)}</span>
                  <span className="text-xs text-muted-foreground">
                    {STORE_ROLE_LABELS[m.role]} in this store
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {superAdmin ? "Close" : "Cancel"}
          </Button>
          {!superAdmin && (
            <Button onClick={submit} disabled={busy || member.memberships.length === 0}>
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
