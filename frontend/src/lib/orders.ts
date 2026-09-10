export type OrderStatus =
  | "processing"
  | "incomplete"
  | "good_but_no_response"
  | "no_response"
  | "advance_payment"
  | "on_hold"
  | "confirmed"
  | "shipped"
  | "cancelled"
  | "history";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  processing: "Processing",
  incomplete: "Incomplete",
  good_but_no_response: "Good But No Response",
  no_response: "No Response",
  advance_payment: "Advance Payment",
  on_hold: "On Hold",
  confirmed: "Confirmed Order",
  shipped: "Shipping",
  cancelled: "Cancel",
  history: "History",
};

export const ORDER_STATUSES: { value: OrderStatus; label: string }[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]
).map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));

export const CHANGE_STATUS_OPTIONS = ORDER_STATUSES;

/**
 * Where an order lives in the sidebar once it carries a given status. Changing
 * the status in the order modal moves the order to the page named here, and it
 * drops out of the page it was changed from. Statuses without a page of their
 * own stay on Web Order Lists.
 */
export const STATUS_PAGES: Record<OrderStatus, { title: string; href: string }> = {
  processing: { title: "Web Order List", href: "/admin/orders" },
  advance_payment: { title: "Web Order List", href: "/admin/orders" },
  incomplete: { title: "Incomplete", href: "/admin/orders/incomplete" },
  good_but_no_response: {
    title: "Good But No Response",
    href: "/admin/orders/good-but-no-response",
  },
  no_response: { title: "No Response", href: "/admin/orders/no-response" },
  on_hold: { title: "Hold", href: "/admin/orders/hold" },
  confirmed: { title: "Confirmed Order", href: "/admin/orders/confirm" },
  shipped: { title: "Shipping", href: "/admin/orders/ship" },
  cancelled: { title: "Cancelled", href: "/admin/orders/cancelled" },
  history: { title: "History", href: "/admin/orders/history" },
};

/** Statuses that have no page of their own, so Web Order Lists holds them. */
export const WEB_ORDER_STATUSES: OrderStatus[] = (
  Object.keys(STATUS_PAGES) as OrderStatus[]
).filter((status) => STATUS_PAGES[status].href === "/admin/orders");

/** The reverse of STATUS_PAGES: which statuses each sidebar page holds. */
export const PAGE_STATUSES: Record<string, OrderStatus[]> = (
  Object.keys(STATUS_PAGES) as OrderStatus[]
).reduce<Record<string, OrderStatus[]>>((pages, status) => {
  const { href } = STATUS_PAGES[status];
  (pages[href] ??= []).push(status);
  return pages;
}, {});

/** How many orders a sidebar page lists, from a status -> count map. */
export function countForPage(
  href: string,
  counts: Partial<Record<OrderStatus, number>>
): number {
  return (PAGE_STATUSES[href] ?? []).reduce(
    (sum, status) => sum + (counts[status] ?? 0),
    0
  );
}

export const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  incomplete: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  good_but_no_response:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  no_response: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  advance_payment:
    "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  on_hold: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  confirmed: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  shipped: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  // Neutral on purpose: an archived order is finished, not another state
  // someone still has to act on.
  history: "bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-300",
};

export type OrderSource = "website" | "incomplete" | "manual";

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  website: "Website",
  incomplete: "Incomplete",
  // Taken by staff from a call, WhatsApp or Messenger.
  manual: "Manual",
};

export const SOURCE_BADGE_CLASS: Record<OrderSource, string> = {
  website: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  incomplete: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  manual: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

/**
 * A staff member's short name for the narrow Staff column.
 *
 * Bangladeshi names often lead with an honorific — "Md jahir uddin Shohan"
 * would otherwise show as "Md" for half the team — so those are skipped in
 * favour of the first real given name.
 */
const HONORIFICS = new Set([
  "md",
  "md.",
  "mohammad",
  "mohammed",
  "muhammad",
  "mohd",
  "mst",
  "mst.",
  "most",
  "most.",
  "mrs",
  "mrs.",
  "mr",
  "mr.",
  "ms",
  "ms.",
]);

/**
 * What to call a staff member in the UI.
 *
 * A nickname a super admin set wins outright — that is the whole point of it.
 * Without one, fall back to trimming the full name down to something that fits
 * a table column.
 */
export function staffLabel(
  fullName: string | null,
  nickname: string | null
): string {
  if (nickname?.trim()) return nickname.trim();
  return fullName ? shortName(fullName) : "";
}

export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const name =
    parts.find((part) => !HONORIFICS.has(part.toLowerCase())) ?? parts[0] ?? "";
  return name ? name[0].toUpperCase() + name.slice(1) : "";
}

export type OrderTag = {
  id: number;
  label: string;
  createdByName: string | null;
  createdByNickname: string | null;
};

/** One product line on an order. */
export type OrderItem = {
  id: number;
  productId: number | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type Order = {
  id: number;
  orderNo: string;
  customerName: string;
  phone: string;
  address: string;
  product: string;
  quantity: number;
  unitPrice: number;
  total: number;
  status: OrderStatus;
  comment: string;
  createdAt: string;
  updatedAt: string;
  source: OrderSource;
  printed: boolean;
  courier: boolean;
  assignedToId: number | null;
  assignedToName: string | null;
  assignedToNickname: string | null;
  assignedAt: string | null;
  /** Server-decided: the claim is recent enough to be a live modal. */
  claimActive: boolean;
  /** Who last moved the status — on a confirmed order, who confirmed it. */
  staffName: string | null;
  staffNickname: string | null;
  /** Captured from an abandoned storefront form; nobody submitted it. */
  autoCaptured: boolean;
  tags: OrderTag[];
  items: OrderItem[];
  /** Pathao's tracking number once the parcel is booked; null before. */
  pathaoConsignmentId: string | null;
  pathaoStatus: string | null;
  pathaoDeliveryFee: number | null;
  pathaoSentAt: string | null;
  pathaoTrackingUrl: string | null;
  /** BDCourier courier history for this phone, once checked. */
  fraud: FraudCheck | null;
};

export function formatOrderDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const time = d
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })
    .toLowerCase();
  return `${date}, ${time}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type ActiveClaim = { id: number; label: string; fullName: string };

/** Who has this order open right now, if anyone. Freshness is judged by the
 * API against its own clock, so this never depends on the staff laptop's. */
export function activeClaim(order: Order): ActiveClaim | null {
  if (!order.claimActive || order.assignedToId == null) return null;
  return {
    id: order.assignedToId,
    label: staffLabel(order.assignedToName, order.assignedToNickname) || "Someone",
    fullName: order.assignedToName ?? "",
  };
}


/** One courier's answer from BDCourier: delivered vs cancelled parcels. */
export type FraudCourier = {
  name: string;
  logo: string | null;
  total: number;
  success: number;
  cancel: number;
  successRate: number | null;
};

/** A fraud report filed against this phone with a courier. */
export type FraudReport = {
  id: string;
  name: string | null;
  details: string | null;
  createdAt: string | null;
  courierName: string | null;
  courierLogo: string | null;
};

export type FraudCheck = {
  id: number;
  checkedAt: string;
  total: number;
  success: number;
  cancel: number;
  /** Delivered share across couriers in percent; null with no history. */
  successRate: number | null;
  couriers: FraudCourier[];
  reports: FraudReport[];
  /** Set when BDCourier could not answer that time. */
  error: string | null;
};
