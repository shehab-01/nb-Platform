"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";

import { SortableHeader } from "@/components/admin/data-table/data-table-sort-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ROLE_LABELS,
  STATUS_LABELS,
  STORE_ROLE_LABELS,
  type TeamMember,
  type UserRole,
  type UserStatus,
} from "@/lib/team";

export function getTeamColumns({
  currentUserId,
  onStatusChange,
  onRoleChange,
  onEditNickname,
  onEditMemberships,
}: {
  currentUserId: number;
  onStatusChange: (id: number, status: UserStatus) => void;
  onRoleChange: (id: number, role: UserRole) => void;
  onEditNickname: (member: TeamMember) => void;
  onEditMemberships: (member: TeamMember) => void;
}): ColumnDef<TeamMember>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Member" },
      header: "Member",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <Avatar>
            {row.original.pictureUrl && (
              <AvatarImage
                src={row.original.pictureUrl}
                alt={row.original.name}
              />
            )}
            <AvatarFallback>
              {row.original.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        </div>
      ),
      filterFn: (row, _columnId, filterValue) => {
        const search = String(filterValue).toLowerCase();
        return (
          row.original.name.toLowerCase().includes(search) ||
          row.original.email.toLowerCase().includes(search) ||
          (row.original.nickname ?? "").toLowerCase().includes(search)
        );
      },
    },
    {
      accessorKey: "nickname",
      meta: { label: "Nickname" },
      header: "Nickname",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.nickname ? (
          <Badge variant="secondary">{row.original.nickname}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "role",
      meta: { label: "Role" },
      header: "Role",
      cell: ({ row }) => (
        <Badge
          variant={row.original.role === "super_admin" ? "default" : "outline"}
        >
          {ROLE_LABELS[row.original.role]}
        </Badge>
      ),
    },
    {
      id: "stores",
      meta: { label: "Stores" },
      header: "Stores",
      enableSorting: false,
      cell: ({ row }) => {
        const m = row.original.memberships;
        if (row.original.role === "super_admin" && m.length === 0) {
          return <span className="text-xs text-muted-foreground">All stores</span>;
        }
        if (m.length === 0) {
          return <span className="text-xs text-muted-foreground">None</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {m.map((x) => (
              <Badge key={x.storeId} variant="outline" title={STORE_ROLE_LABELS[x.role]}>
                {x.name}
                <span className="ml-1 text-muted-foreground">{STORE_ROLE_LABELS[x.role].toLowerCase()}</span>
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      meta: { label: "Status" },
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.status === "active" ? "secondary" : "destructive"
          }
        >
          {STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: "ordersConfirmed",
      meta: { label: "Confirmed" },
      header: ({ column }) => (
        <SortableHeader
          label="Confirmed"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.ordersConfirmed}</span>
      ),
    },
    {
      accessorKey: "ordersShipped",
      meta: { label: "Shipped" },
      header: ({ column }) => (
        <SortableHeader
          label="Shipped"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.ordersShipped}</span>
      ),
    },
    {
      accessorKey: "lastActiveAt",
      meta: { label: "Last active" },
      header: ({ column }) => (
        <SortableHeader
          label="Last active"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        row.original.lastActiveAt
          ? new Date(row.original.lastActiveAt).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—",
    },
    {
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        // Suspending is what could lock someone out, so it stays off limits
        // for super admins and for your own account. A nickname is only a
        // label, so anyone on the team can be given one.
        const member = row.original;
        const isSelf = member.id === currentUserId;
        const canChangeAccess = member.role !== "super_admin" && !isSelf;
        // Anyone but yourself can be promoted; a super admin can be made
        // staff again unless the server configuration pins the role. The
        // API also refuses to demote the last super admin.
        const canChangeRole = !isSelf && !(member.role === "super_admin" && member.pinned);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onEditNickname(row.original)}>
                {row.original.nickname ? "Change nickname" : "Set nickname"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEditMemberships(row.original)}>
                Assign stores
              </DropdownMenuItem>
              {canChangeRole && <DropdownMenuSeparator />}
              {canChangeRole &&
                (member.role === "super_admin" ? (
                  <DropdownMenuItem
                    onClick={() => onRoleChange(member.id, "staff")}
                  >
                    Remove super admin
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => onRoleChange(member.id, "super_admin")}
                  >
                    Make super admin
                  </DropdownMenuItem>
                ))}
              {canChangeAccess && <DropdownMenuSeparator />}
              {canChangeAccess &&
                (row.original.status === "active" ? (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onStatusChange(row.original.id, "suspended")}
                  >
                    Disable access
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => onStatusChange(row.original.id, "active")}
                  >
                    Reactivate
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
