"use client";

import * as React from "react";

import { useAuth } from "@/components/admin/auth-context";
import { DataTable } from "@/components/admin/data-table/data-table";
import { getTeamColumns } from "@/components/admin/users/columns";
import { MembershipsDialog } from "@/components/admin/users/memberships-dialog";
import { NicknameDialog } from "@/components/admin/users/nickname-dialog";
import { PendingRequests } from "@/components/admin/users/pending-requests";
import {
  deleteUser,
  listStores,
  listUsers,
  setUserMemberships,
  updateUser,
  type Store,
} from "@/lib/api";
import type { StoreRole, TeamMember, UserRole, UserStatus } from "@/lib/team";

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = React.useState<TeamMember[]>([]);
  const [stores, setStores] = React.useState<Store[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [people, shops] = await Promise.all([listUsers(), listStores()]);
      setUsers(people);
      setStores(shops);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleApprove = React.useCallback(
    async (id: number) => {
      try {
        await updateUser(id, { status: "active" });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to approve");
      }
    },
    [refresh]
  );

  const handleDeny = React.useCallback(
    async (id: number) => {
      try {
        await deleteUser(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to deny");
      }
    },
    [refresh]
  );

  const handleStatusChange = React.useCallback(
    async (id: number, status: UserStatus) => {
      try {
        await updateUser(id, { status });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update user");
      }
    },
    [refresh]
  );

  const handleRoleChange = React.useCallback(
    async (id: number, role: UserRole) => {
      const member = users.find((u) => u.id === id);
      const name = member?.nickname || member?.name || "this member";
      const question =
        role === "super_admin"
          ? `Make ${name} a super admin? They will see every store and manage stores and users.`
          : `Remove super admin from ${name}? They will only see the stores assigned to them.`;
      if (!window.confirm(question)) return;
      try {
        await updateUser(id, { role });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to change role");
      }
    },
    [refresh, users]
  );

  const [nicknameFor, setNicknameFor] = React.useState<TeamMember | null>(null);
  const [membershipsFor, setMembershipsFor] = React.useState<TeamMember | null>(null);

  const handleMemberships = React.useCallback(
    async (id: number, memberships: { storeId: number; role: StoreRole }[]) => {
      await setUserMemberships(id, memberships);
      await refresh();
    },
    [refresh]
  );

  const handleNickname = React.useCallback(
    async (id: number, nickname: string) => {
      try {
        await updateUser(id, { nickname });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to set nickname");
      }
    },
    [refresh]
  );

  const columns = React.useMemo(
    () =>
      getTeamColumns({
        currentUserId: currentUser.id,
        onStatusChange: handleStatusChange,
        onRoleChange: handleRoleChange,
        onEditNickname: setNicknameFor,
        onEditMemberships: setMembershipsFor,
      }),
    [currentUser.id, handleStatusChange, handleRoleChange]
  );

  const pending = users.filter((u) => u.status === "pending");
  const team = users.filter((u) => u.status !== "pending");

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Approve sign-in requests, assign people to stores, and keep track of
        what each member has done. Approving someone does not open any store
        for them until they are assigned one.
      </p>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading users…</p>
      ) : (
        <>
          <PendingRequests
            requests={pending}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />

          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-foreground">Team</h3>
            <DataTable
              columns={columns}
              data={team}
              searchColumnId="name"
              searchPlaceholder="Search by name or email..."
              storageKey="users"
            />
          </div>
        </>
      )}

      <NicknameDialog
        member={nicknameFor}
        onOpenChange={(open) => !open && setNicknameFor(null)}
        onSave={handleNickname}
      />
      <MembershipsDialog
        member={membershipsFor}
        stores={stores}
        onOpenChange={(open) => !open && setMembershipsFor(null)}
        onSave={handleMemberships}
      />
    </div>
  );
}
