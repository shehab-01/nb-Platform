import { Globe, List, Search, ShoppingCart, type LucideIcon } from "lucide-react";

import { STATUS_PAGES } from "@/lib/orders";

/**
 * The title shown in the header for each admin route. It replaces the heading
 * block that used to sit at the top of every page.
 */
export const PAGE_TITLES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/orders/manual": "Manual Order",
  "/admin/products": "Products",
  "/admin/stores": "Stores",
  "/admin/stores/new": "New store",
  "/admin/templates": "Templates",
  "/admin/settings": "Store settings",
  "/admin/users": "Users & access",
  "/admin/system": "System",
  // Every order list names itself once, in STATUS_PAGES.
  ...Object.fromEntries(
    Object.values(STATUS_PAGES).map(({ href, title }) => [href, title])
  ),
};

export function pageTitle(pathname: string): string {
  if (/^\/admin\/stores\/\d+$/.test(pathname)) return "Edit store";
  return PAGE_TITLES[pathname] ?? "Admin";
}

export type HeaderLink = {
  title: string;
  icon: LucideIcon;
  /** Omitted while the screen behind it is still to be built. */
  href?: string;
};

/** The quick menu in the header. */
export const HEADER_LINKS: HeaderLink[] = [
  { title: "Search", icon: Search },
  { title: "New Order", icon: ShoppingCart, href: "/admin/orders/manual" },
  { title: "Web Order List", icon: Globe, href: "/admin/orders" },
  { title: "Order List", icon: List },
];
