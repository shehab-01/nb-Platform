"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  ChevronsUpDown,
  Activity,
  Check,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
  Store,
  Users,
} from "lucide-react";

import { useAuth, type Permission } from "@/components/admin/auth-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { PAGE_STATUSES, countForPage } from "@/lib/orders";
import { ROLE_LABELS, STORE_ROLE_LABELS, type StoreRole } from "@/lib/team";
import { useOrderCounts } from "@/lib/use-order-counts";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  /** Needed in the current store to see this item. */
  permission?: Permission;
  children?: { title: string; url: string }[];
};

/** Everything about the store being worked in. */
const storeNav: NavItem[] = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard, permission: "orders" },
  {
    title: "Web Orders",
    url: "/admin/orders",
    icon: ShoppingCart,
    permission: "orders",
    children: [
      { title: "Manual Order", url: "/admin/orders/manual" },
      { title: "Web Order List", url: "/admin/orders" },
      { title: "Incomplete", url: "/admin/orders/incomplete" },
      { title: "Good But No Response", url: "/admin/orders/good-but-no-response" },
      { title: "No Response", url: "/admin/orders/no-response" },
      { title: "Hold", url: "/admin/orders/hold" },
      { title: "Confirmed Order", url: "/admin/orders/confirm" },
      { title: "Shipping", url: "/admin/orders/ship" },
      { title: "Cancelled", url: "/admin/orders/cancelled" },
      { title: "History", url: "/admin/orders/history" },
    ],
  },
  { title: "Products", url: "/admin/products", icon: Package, permission: "catalogue.read" },
  { title: "Settings", url: "/admin/settings", icon: Settings, permission: "settings" },
];

/** The platform: stores and people. Super admin only; no store role reaches it. */
const platformNav: NavItem[] = [
  { title: "Stores", url: "/admin/stores", icon: Store },
  { title: "Templates", url: "/admin/templates", icon: LayoutTemplate },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "System", url: "/admin/system", icon: Activity },
];

function roleLabel(role: string): string {
  return role === "super_admin"
    ? ROLE_LABELS.super_admin
    : STORE_ROLE_LABELS[role as StoreRole] ?? role;
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { user, isSuperAdmin, stores, store, can, selectStore, logout } = useAuth();
  const counts = useOrderCounts();

  const items = store
    ? storeNav.filter((item) => !item.permission || can(item.permission))
    : [];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* The store switcher. One store: a label. Several: a menu of
                exactly the stores this person may open; picking one reloads
                the admin with X-Admin-Store set to it. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={stores.length < 2}>
                <SidebarMenuButton size="lg">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Store className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {store?.name ?? "No store yet"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {store ? roleLabel(store.role) : "Create one under Stores"}
                    </span>
                  </div>
                  {stores.length > 1 && <ChevronsUpDown className="ml-auto size-4" />}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="bottom"
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              >
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  Switch store
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {stores.map((s) => (
                  <DropdownMenuItem key={s.storeId} onClick={() => selectStore(s.storeId)}>
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {roleLabel(s.role)}
                    </span>
                    {s.storeId === store?.storeId && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Store</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive =
                  item.url === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.url);

                if (item.children) {
                  return (
                    <Collapsible
                      key={item.title}
                      asChild
                      defaultOpen={isActive}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton tooltip={item.title}>
                            <item.icon />
                            <span>{item.title}</span>
                            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.children.map((child) => {
                              // null until the first fetch lands, so the
                              // counters don't flash a wrong 0 on every load —
                              // and null for a page that holds no orders at
                              // all, like the Manual Order form, which would
                              // otherwise wear a permanent 0.
                              const count =
                                counts && PAGE_STATUSES[child.url]
                                  ? countForPage(child.url, counts)
                                  : null;
                              return (
                                <SidebarMenuSubItem key={child.title}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={pathname === child.url}
                                  >
                                    <Link href={child.url}>
                                      <span className="truncate">
                                        {child.title}
                                      </span>
                                      {count !== null && (
                                        <span
                                          className={cn(
                                            "ml-auto shrink-0 text-xs tabular-nums",
                                            count > 0
                                              ? "font-medium text-sidebar-foreground"
                                              : "text-muted-foreground/60"
                                          )}
                                        >
                                          {count}
                                        </span>
                                      )}
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {platformNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8 rounded-lg">
                    {user.pictureUrl && (
                      <AvatarImage src={user.pictureUrl} alt={user.name} />
                    )}
                    <AvatarFallback className="rounded-lg">
                      {user.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              >
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  {isSuperAdmin ? ROLE_LABELS.super_admin : "Member"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
