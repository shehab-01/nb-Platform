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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Store } from "@/lib/api";
import {
  STORE_ROLE_HELP,
  STORE_ROLE_LABELS,
  type StoreRole,
  type TeamMember,
} from "@/lib/team";

const ROLES: StoreRole[] = ["owner", "manager", "staff"];

/**
 * Which stores a person may open, and as what. Ticking a store adds a
 * membership with the chosen role; unticking removes it. Saving replaces the
 * whole list. Nobody is deleted here: a person with no stores keeps their
 * account and sees the waiting page.
 */
export function MembershipsDialog({
  member,
  stores,
  onOpenChange,
  onSave,
}: {
  member: TeamMember | null;
  stores: Store[];
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, memberships: { storeId: number; role: StoreRole }[]) => Promise<void>;
}) {
  const [roles, setRoles] = React.useState<Record<number, StoreRole>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (member) {
      setRoles(Object.fromEntries(member.memberships.map((m) => [m.storeId, m.role])));
      setError(null);
    }
  }, [member]);

  if (!member) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(
        member.id,
        Object.entries(roles).map(([storeId, role]) => ({ storeId: Number(storeId), role }))
      );
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
          <DialogTitle>Stores for {member.nickname || member.name}</DialogTitle>
          <DialogDescription>
            {member.role === "super_admin"
              ? "A super admin already sees every store; memberships here only matter if the role is ever removed."
              : "Tick the stores this person works in and pick a role in each."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col divide-y rounded-lg border">
          {stores.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No stores exist yet.</p>
          )}
          {stores.map((store) => {
            const role = roles[store.id];
            return (
              <div key={store.id} className="flex items-center gap-3 px-3 py-2">
                <Checkbox
                  id={`store-${store.id}`}
                  checked={role !== undefined}
                  onCheckedChange={(checked) => {
                    const next = { ...roles };
                    if (checked) next[store.id] = next[store.id] ?? "staff";
                    else delete next[store.id];
                    setRoles(next);
                  }}
                />
                <label htmlFor={`store-${store.id}`} className="flex flex-1 flex-col text-sm">
                  <span className="font-medium">
                    {store.name}
                    {!store.isActive && (
                      <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {store.primaryDomain ?? store.slug}
                  </span>
                </label>
                <Select
                  value={role ?? "staff"}
                  disabled={role === undefined}
                  onValueChange={(value) =>
                    setRoles({ ...roles, [store.id]: value as StoreRole })
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {STORE_ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>

        <ul className="text-xs text-muted-foreground">
          {ROLES.map((r) => (
            <li key={r}>
              <span className="font-medium text-foreground">{STORE_ROLE_LABELS[r]}</span>:{" "}
              {STORE_ROLE_HELP[r]}
            </li>
          ))}
        </ul>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            Save stores
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
