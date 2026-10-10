"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { listProductionAccess, setProductionAccess, type ProductionMember } from "@/lib/api";

/**
 * Who may record productions in this store, for production admins: every
 * member with a switch. A production admin (by address) has a badge instead,
 * since the switch would change nothing for them.
 */
export function AccessDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [members, setMembers] = React.useState<ProductionMember[] | null>(null);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    listProductionAccess()
      .then((m) => !cancelled && setMembers(m))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggle = async (m: ProductionMember, write: boolean) => {
    setBusy(m.user_id);
    setError(null);
    try {
      setMembers(await setProductionAccess(m.user_id, write));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change access");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Production access</DialogTitle>
          <DialogDescription>
            কারা নতুন প্রোডাকশন লিখতে পারবেন, তা বেছে নিন। তারা আজকের প্রোডাকশন যোগ করতে আর সব
            দেখতে পারবেন, কিন্তু সেভ করা কিছু বদলাতে বা মুছতে পারবেন না।
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 overflow-y-auto px-6">
          {members === null ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              এই স্টোরে এখনো কোনো সদস্য নেই।
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar className="size-9">
                    {m.picture_url && <AvatarImage src={m.picture_url} alt="" />}
                    <AvatarFallback>{m.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.email} · <span className="capitalize">{m.role}</span>
                    </div>
                  </div>
                  {m.level === "admin" ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      Production admin
                    </span>
                  ) : (
                    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      Can write
                      <Switch
                        checked={m.level === "write"}
                        disabled={busy === m.user_id}
                        onCheckedChange={(on) => toggle(m, on)}
                        aria-label={`${m.name} can record productions`}
                      />
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            সুপার অ্যাডমিন সব স্টোরে সব করতে পারেন, তাই এই তালিকায় নেই। কেউ তালিকায় না থাকলে আগে
            তাকে স্টোরের সদস্য করতে হবে।
          </p>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
