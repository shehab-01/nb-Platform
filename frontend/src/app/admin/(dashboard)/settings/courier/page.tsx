"use client";

import { useAuth } from "@/components/admin/auth-context";
import { CourierAccounts } from "@/components/admin/settings/courier-accounts";

/** Settings → Courier: the courier accounts every store picks from. Super admin only. */
export default function CourierSettingsPage() {
  const { isSuperAdmin } = useAuth();
  if (!isSuperAdmin) {
    return <p className="text-sm text-muted-foreground">Only a super admin can manage courier accounts.</p>;
  }
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        One account per Pathao or Carrybee merchant account. Stores booking through the same one pick the same
        account in their settings, and share its webhook.
      </p>
      <CourierAccounts />
    </div>
  );
}
