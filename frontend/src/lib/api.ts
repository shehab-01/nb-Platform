import { request, requestBlob, requestForm, requestVoid } from "@/lib/http";
import type {
  FraudCheck,
  Order,
  OrderItem,
  OrderSource,
  OrderStatus,
  OrderTag,
  PathaoConfidence,
  PathaoLocation,
} from "@/lib/orders";
import type { Product, Variant } from "@/lib/products";
import type { StoreAccess } from "@/lib/admin-store";
import type { Membership, StoreRole, TeamMember, UserRole, UserStatus } from "@/lib/team";

// Same-origin "/api/*" is proxied by Next.js to the FastAPI service
// (see next.config.ts), so no CORS and only one exposed port.

type ApiOrder = {
  id: number;
  order_no: string;
  customer_name: string;
  phone: string;
  address: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  status: OrderStatus;
  comment: string;
  created_at: string;
  updated_at: string;
  source: OrderSource;
  printed: boolean;
  courier: boolean;
  assigned_to: number | null;
  assigned_to_name: string | null;
  assigned_to_nickname: string | null;
  assigned_at: string | null;
  claim_active: boolean;
  handled_by_name: string | null;
  handled_by_nickname: string | null;
  auto_captured: boolean;
  pathao_consignment_id: string | null;
  pathao_status: string | null;
  pathao_delivery_fee: number | null;
  pathao_sent_at: string | null;
  pathao_tracking_url: string | null;
  pathao_city_id?: number | null;
  pathao_zone_id?: number | null;
  pathao_area_id?: number | null;
  pathao_address_confidence?: PathaoConfidence | null;
  tags: {
    id: number;
    label: string;
    created_by_name: string | null;
    created_by_nickname: string | null;
  }[];
  items: ApiOrderItem[];
  fraud_check: ApiFraudCheck | null;
};

type ApiFraudCheck = {
  id: number;
  checked_at: string;
  total: number;
  success: number;
  cancel: number;
  success_rate: string | number | null;
  couriers: {
    name: string;
    logo: string | null;
    total: number;
    success: number;
    cancel: number;
    success_rate: number | null;
  }[];
  reports: {
    id: string;
    name: string | null;
    details: string | null;
    created_at: string | null;
    courier_name: string | null;
    courier_logo: string | null;
  }[];
  error: string | null;
};

function mapFraud(f: ApiFraudCheck | null | undefined): FraudCheck | null {
  if (!f) return null;
  return {
    id: f.id,
    checkedAt: f.checked_at,
    total: f.total,
    success: f.success,
    cancel: f.cancel,
    successRate: f.success_rate == null ? null : Number(f.success_rate),
    couriers: (f.couriers ?? []).map((c) => ({
      name: c.name,
      logo: c.logo ?? null,
      total: c.total,
      success: c.success,
      cancel: c.cancel,
      successRate: c.success_rate,
    })),
    reports: (f.reports ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      details: r.details,
      createdAt: r.created_at,
      courierName: r.courier_name,
      courierLogo: r.courier_logo,
    })),
    error: f.error,
  };
}

type ApiOrderItem = {
  id: number;
  product_id: number | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
};

export type OrderListResponse = {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

export type OrderStats = {
  total: number;
  in_progress: number;
  confirmed: number;
  cancelled: number;
  revenue: number;
  incomplete: number;
};

export type OrderListParams = {
  page?: number;
  pageSize?: number;
  status?: OrderStatus[];
  /** How the order arrived: website, a recovered incomplete form, or manual. */
  source?: OrderSource[];
  /** Delivery column values: "not_sent", "pending" or "status:<Pathao text>". */
  delivery?: string[];
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  sort?: string;
};

function mapOrder(order: ApiOrder): Order {
  return {
    id: order.id,
    orderNo: order.order_no,
    customerName: order.customer_name,
    phone: order.phone,
    address: order.address,
    product: order.product_name,
    quantity: order.quantity,
    unitPrice: order.unit_price,
    total: order.total_amount,
    status: order.status,
    comment: order.comment,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    source: order.source,
    printed: order.printed,
    courier: order.courier,
    assignedToId: order.assigned_to,
    assignedToName: order.assigned_to_name,
    assignedToNickname: order.assigned_to_nickname,
    assignedAt: order.assigned_at,
    claimActive: order.claim_active,
    staffName: order.handled_by_name,
    staffNickname: order.handled_by_nickname,
    autoCaptured: order.auto_captured,
    pathaoConsignmentId: order.pathao_consignment_id ?? null,
    pathaoStatus: order.pathao_status ?? null,
    pathaoDeliveryFee: order.pathao_delivery_fee ?? null,
    pathaoSentAt: order.pathao_sent_at ?? null,
    pathaoTrackingUrl: order.pathao_tracking_url ?? null,
    pathaoLocation: {
      cityId: order.pathao_city_id ?? null,
      zoneId: order.pathao_zone_id ?? null,
      areaId: order.pathao_area_id ?? null,
    },
    pathaoAddressConfidence: order.pathao_address_confidence ?? null,
    fraud: mapFraud(order.fraud_check),
    items: (order.items ?? []).map(
      (item): OrderItem => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        unitPrice: item.unit_price,
        quantity: item.quantity,
        lineTotal: item.line_total,
      })
    ),
    tags: order.tags.map(
      (tag): OrderTag => ({
        id: tag.id,
        label: tag.label,
        createdByName: tag.created_by_name,
        createdByNickname: tag.created_by_nickname,
      })
    ),
  };
}

export async function getOrderCounts(): Promise<Record<OrderStatus, number>> {
  const data = await request<{ counts: Record<string, number> }>(
    "/api/orders/counts"
  );
  return data.counts as Record<OrderStatus, number>;
}

/** The Pathao status texts the store's booked orders carry, within `status`. */
export async function listDeliveryStatuses(status: OrderStatus[]): Promise<string[]> {
  const search = new URLSearchParams();
  for (const s of status) search.append("status", s);
  return request<string[]>(`/api/orders/delivery-statuses?${search}`);
}

export async function listOrders(
  params: OrderListParams
): Promise<OrderListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("page_size", String(params.pageSize));
  for (const status of params.status ?? []) search.append("status", status);
  for (const source of params.source ?? []) search.append("source", source);
  for (const value of params.delivery ?? []) search.append("delivery", value);
  if (params.dateFrom) search.set("date_from", params.dateFrom);
  if (params.dateTo) search.set("date_to", params.dateTo);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);

  const data = await request<{
    items: ApiOrder[];
    total: number;
    page: number;
    page_size: number;
    pages: number;
  }>(`/api/orders?${search.toString()}`);

  return {
    items: data.items.map(mapOrder),
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
    pages: data.pages,
  };
}

export async function updateOrder(
  id: number,
  patch: {
    status?: OrderStatus;
    comment?: string;
    customerName?: string;
    phone?: string;
    address?: string;
    printed?: boolean;
    courier?: boolean;
    /** Replaces the delivery location outright; leave out to keep it. */
    pathaoLocation?: PathaoLocation;
  }
): Promise<Order> {
  const order = await request<ApiOrder>(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: patch.status,
      comment: patch.comment,
      customer_name: patch.customerName,
      phone: patch.phone,
      address: patch.address,
      printed: patch.printed,
      courier: patch.courier,
      pathao_location: patch.pathaoLocation
        ? locationBody(patch.pathaoLocation)
        : undefined,
    }),
  });
  return mapOrder(order);
}

export type BulkSkipped = { orderId: number; orderNo: string; reason: string };

/** One change on many orders. Orders someone else holds come back skipped. */
export async function bulkUpdateOrders(
  ids: number[],
  patch: { status?: OrderStatus; printed?: boolean; courier?: boolean }
): Promise<{ updated: Order[]; skipped: BulkSkipped[] }> {
  const data = await request<{
    updated: ApiOrder[];
    skipped: { order_id: number; order_no: string; reason: string }[];
  }>("/api/orders/bulk", {
    method: "POST",
    body: JSON.stringify({
      order_ids: ids,
      status: patch.status,
      printed: patch.printed,
      courier: patch.courier,
    }),
  });
  return {
    updated: data.updated.map(mapOrder),
    skipped: data.skipped.map((s) => ({
      orderId: s.order_id,
      orderNo: s.order_no,
      reason: s.reason,
    })),
  };
}

export type PathaoFailure = { orderId: number; orderNo: string; error: string };
export type PathaoResult = { orders: Order[]; failed: PathaoFailure[] };

type ApiPathaoResult = {
  orders: ApiOrder[];
  failed: { order_id: number; order_no: string; error: string }[];
};

function mapPathaoResult(data: ApiPathaoResult): PathaoResult {
  return {
    orders: data.orders.map(mapOrder),
    failed: data.failed.map((f) => ({
      orderId: f.order_id,
      orderNo: f.order_no,
      error: f.error,
    })),
  };
}

/**
 * How many orders go in one Pathao request. Must not exceed the API's own
 * PATHAO_BATCH_LIMIT, which rejects anything larger.
 *
 * The server talks to Pathao one order at a time — only the per-order endpoint
 * returns a consignment id, and we need that to track and print the parcel —
 * so a batch's wall time grows with its length. Twenty finishes inside
 * Cloudflare's 100s proxy timeout with room to spare.
 */
const PATHAO_BATCH = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Run a Pathao call in batches, back to back, merging the results.
 *
 * Each batch the server accepts is committed order by order, so work already
 * done survives a later batch failing: once anything has come back we return
 * the partial result and report the rest as failures rather than throwing away
 * the successes. A first-batch failure still throws, so a small selection
 * behaves exactly as a single request would.
 */
async function pathaoBatched(
  path: string,
  ids: number[]
): Promise<PathaoResult> {
  const merged: PathaoResult = { orders: [], failed: [] };
  const batches = chunk(ids, PATHAO_BATCH);

  for (const [index, batch] of batches.entries()) {
    try {
      const result = mapPathaoResult(
        await request<ApiPathaoResult>(path, {
          method: "POST",
          body: JSON.stringify({ order_ids: batch }),
        })
      );
      merged.orders.push(...result.orders);
      merged.failed.push(...result.failed);
    } catch (err) {
      if (index === 0) throw err;
      // Some of this batch may already be booked at Pathao, so the reason says
      // "check" rather than claiming they were not sent. Re-sending is safe
      // either way: the API refuses an order that already has a consignment.
      const reason = err instanceof Error ? err.message : "Request failed";
      for (const id of batches.slice(index).flat()) {
        merged.failed.push({
          orderId: id,
          orderNo: `#${id}`,
          error: `Not completed — ${reason}. Check Pathao before retrying.`,
        });
      }
      break;
    }
  }
  return merged;
}

function locationBody(location: PathaoLocation) {
  return {
    city_id: location.cityId,
    zone_id: location.zoneId,
    area_id: location.areaId,
  };
}

/** One of Pathao's cities, zones or areas. */
export type PathaoPlace = { id: number; name: string };

/**
 * Pathao's geography is the same for every store and changes rarely, so each
 * list is fetched once per page load and shared by every picker on it. A
 * failed fetch is not kept: the next picker asks again.
 */
const placeCache = new Map<string, Promise<PathaoPlace[]>>();

function places(path: string): Promise<PathaoPlace[]> {
  const cached = placeCache.get(path);
  if (cached) return cached;
  const pending = request<PathaoPlace[]>(path).catch((err) => {
    placeCache.delete(path);
    throw err;
  });
  placeCache.set(path, pending);
  return pending;
}

/** Answers 503 (ApiError) when the store has no Pathao credentials. */
export function listPathaoCities(): Promise<PathaoPlace[]> {
  return places("/api/orders/pathao/cities");
}

export function listPathaoZones(cityId: number): Promise<PathaoPlace[]> {
  return places(`/api/orders/pathao/cities/${cityId}/zones`);
}

export function listPathaoAreas(zoneId: number): Promise<PathaoPlace[]> {
  return places(`/api/orders/pathao/zones/${zoneId}/areas`);
}

export type AddressParse = {
  /** false for "Pathao could not place it" and for any failure alike. */
  matched: boolean;
  cityId: number | null;
  cityName: string | null;
  zoneId: number | null;
  zoneName: string | null;
  areaId: number | null;
  areaName: string | null;
  confidence: "high" | "medium" | "low";
};

type ApiAddressParse = {
  matched: boolean;
  city_id: number | null;
  city_name: string | null;
  zone_id: number | null;
  zone_name: string | null;
  area_id: number | null;
  area_name: string | null;
  confidence: "high" | "medium" | "low";
};

/**
 * Ask Pathao where a typed address is. Never throws for a miss: the server
 * answers matched=false whenever it has nothing, and the form leaves the
 * dropdowns to staff. Only a store without Pathao gets an error (503).
 */
export async function parseAddress(address: string): Promise<AddressParse> {
  const r = await request<ApiAddressParse>("/api/orders/pathao/parse-address", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
  return {
    matched: r.matched,
    cityId: r.city_id,
    cityName: r.city_name,
    zoneId: r.zone_id,
    zoneName: r.zone_name,
    areaId: r.area_id,
    areaName: r.area_name,
    confidence: r.confidence,
  };
}

/**
 * Parse an existing order's saved address and store the answer on it. Only
 * fills a blank location; an order already decided comes back unchanged.
 */
export async function parseOrderAddress(orderId: number): Promise<Order> {
  return mapOrder(
    await request<ApiOrder>(`/api/orders/${orderId}/pathao/parse-address`, {
      method: "POST",
    })
  );
}

/** Book each order with Pathao. Successes carry the consignment id. */
export async function sendToPathao(ids: number[]): Promise<PathaoResult> {
  return pathaoBatched("/api/orders/pathao/send", ids);
}

/** Pull the latest delivery status from Pathao for booked orders. */
export async function refreshPathao(ids: number[]): Promise<PathaoResult> {
  return pathaoBatched("/api/orders/pathao/refresh", ids);
}

/** Take an order (open its modal). 409 means someone else is on it. */
export async function claimOrder(id: number): Promise<Order> {
  return mapOrder(
    await request<ApiOrder>(`/api/orders/${id}/claim`, { method: "POST" })
  );
}

export type Claim = {
  id: number;
  assignedToId: number;
  assignedToName: string | null;
  assignedToNickname: string | null;
  assignedAt: string;
};

/** Who holds which order right now — small enough to poll every few seconds. */
export async function listClaims(): Promise<{ ttlSeconds: number; claims: Claim[] }> {
  const data = await request<{
    ttl_seconds: number;
    claims: {
      id: number;
      assigned_to: number;
      assigned_to_name: string | null;
      assigned_to_nickname: string | null;
      assigned_at: string;
    }[];
  }>("/api/orders/claims");
  return {
    ttlSeconds: data.ttl_seconds,
    claims: data.claims.map((c) => ({
      id: c.id,
      assignedToId: c.assigned_to,
      assignedToName: c.assigned_to_name,
      assignedToNickname: c.assigned_to_nickname,
      assignedAt: c.assigned_at,
    })),
  };
}

/** Release on the way out of the page; keepalive survives the tab closing. */
export function releaseOrderOnLeave(id: number): void {
  try {
    void fetch(`/api/orders/${id}/release`, { method: "POST", keepalive: true });
  } catch {
    // The claim expires on its own after CLAIM_TTL_MS anyway.
  }
}

export async function releaseOrder(id: number): Promise<Order> {
  return mapOrder(
    await request<ApiOrder>(`/api/orders/${id}/release`, { method: "POST" })
  );
}

export async function addOrderTag(orderId: number, label: string): Promise<Order> {
  return mapOrder(
    await request<ApiOrder>(`/api/orders/${orderId}/tags`, {
      method: "POST",
      body: JSON.stringify({ label }),
    })
  );
}

export async function getOrderStats(): Promise<OrderStats> {
  return request<OrderStats>("/api/orders/stats");
}

export type DashboardTotals = {
  orders: number;
  confirmed: number;
  delivered: number;
};

export type DashboardPeriod = {
  landed: number;
  processing: number;
  confirmed: number;
  no_response: number;
  cancelled: number;
  manual: number;
  leads: number;
  leads_processing: number;
  leads_confirmed: number;
};

export type Performer = {
  user_id: number;
  name: string;
  nickname: string | null;
  confirmed: number;
  handled: number;
};

export type Dashboard = {
  date_from: string;
  date_to: string;
  month: string;
  this_month: DashboardTotals;
  last_month: DashboardTotals;
  period: DashboardPeriod;
  performers: Performer[];
  /** Ranked over orders recovered from the Incomplete list only. */
  lead_performers: Performer[];
};

/** The home page's figures for a range of Dhaka days and the month it ends in. */
export async function getDashboard(from: string, to: string): Promise<Dashboard> {
  return request<Dashboard>(`/api/orders/dashboard?from=${from}&to=${to}`);
}

/**
 * One person's work on one Dhaka day. handled / no_response / cancelled are
 * what they did that day; confirmed onwards are the orders they confirmed
 * that day, judged by where those orders are now (delivered fills in later).
 */
export type StaffDayStats = {
  user_id: number;
  day: string;
  handled: number;
  no_response: number;
  cancelled: number;
  confirmed: number;
  from_incomplete: number;
  delivered: number;
  returned: number;
  /** Sent to Pathao, not yet delivered or returned. */
  in_transit: number;
};

export type StaffMember = { user_id: number; name: string; nickname: string | null };

export type StaffStats = {
  month: string;
  staff: StaffMember[];
  days: StaffDayStats[];
};

/** Every person's figures for each day of a month ("2026-10"). */
export async function getStaffStats(month: string): Promise<StaffStats> {
  return request<StaffStats>(`/api/orders/staff-stats?month=${month}`);
}

export type StaffDayOrder = {
  order_id: number;
  order_no: string;
  customer_name: string;
  source: string;
  status: string;
  pathao_status: string | null;
  /** Pathao's tracking number, once booked. */
  consignment_id: string | null;
  delivered: boolean;
  confirmed_at: string;
};

/** The orders confirmed on one day and where their parcels are now. */
export type DeliveryTeamDay = {
  day: string;
  /** Handed to Pathao. */
  sent: number;
  delivered: number;
  returned: number;
  /** With Pathao, not yet delivered or returned. */
  in_transit: number;
};

/** The store's parcels for a month, by the day each order was confirmed —
 *  confirmed 31 December, delivered 10 January, is December's. */
export type DeliveryTeam = {
  month: string;
  sent: number;
  delivered: number;
  returned: number;
  in_transit: number;
  days: DeliveryTeamDay[];
};

export async function getDeliveryTeam(month: string): Promise<DeliveryTeam> {
  return request<DeliveryTeam>(`/api/orders/delivery-team?month=${month}`);
}

/** One person's parcels still with Pathao, from orders they confirmed in a
 *  month ("2026-10"). Returns and paid returns are finished, so never listed. */
export async function getStaffInTransit(
  userId: number,
  month: string
): Promise<StaffDayOrder[]> {
  return request<StaffDayOrder[]>(
    `/api/orders/staff-stats/in-transit?user_id=${userId}&month=${month}`
  );
}

/** The orders credited to one person on one day, as they stand now. */
export async function getStaffDayOrders(
  userId: number,
  day: string
): Promise<StaffDayOrder[]> {
  return request<StaffDayOrder[]>(
    `/api/orders/staff-stats/day?user_id=${userId}&day=${day}`
  );
}

export type Activity = {
  id: number;
  order_id: number;
  order_no: string;
  customer_name: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  note: string | null;
  created_at: string;
};

/** What one staff member did to orders over those days, newest first. */
export async function getDashboardActivity(
  userId: number,
  from: string,
  to: string,
  leads = false
): Promise<Activity[]> {
  return request<Activity[]>(
    `/api/orders/dashboard/activity?user_id=${userId}&from=${from}&to=${to}` +
      (leads ? "&leads=true" : "")
  );
}

// ---- Auth & users ----

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  nickname: string | null;
  pictureUrl: string | null;
  role: UserRole;
  status: UserStatus;
};

type ApiUser = {
  id: number;
  email: string;
  name: string;
  nickname: string | null;
  picture_url: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  last_active_at: string | null;
  orders_confirmed?: number;
  orders_shipped?: number;
  pinned?: boolean;
  memberships?: ApiMembership[];
};

type ApiMembership = {
  store_id: number;
  slug: string;
  name: string;
  subtitle?: string | null;
  role: StoreRole;
  crm?: boolean;
};

function mapMembership(m: ApiMembership): Membership {
  return {
    storeId: m.store_id,
    slug: m.slug,
    name: m.name,
    subtitle: m.subtitle ?? null,
    role: m.role,
    crm: m.crm ?? false,
  };
}

function mapAuthUser(user: ApiUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    nickname: user.nickname,
    pictureUrl: user.picture_url,
    role: user.role,
    status: user.status,
  };
}

function mapTeamMember(user: ApiUser): TeamMember {
  return {
    ...mapAuthUser(user),
    joinedAt: user.created_at,
    lastActiveAt: user.last_active_at,
    ordersConfirmed: user.orders_confirmed ?? 0,
    ordersShipped: user.orders_shipped ?? 0,
    pinned: user.pinned ?? false,
    memberships: (user.memberships ?? []).map(mapMembership),
  };
}

/** Choose which of a user's stores they may open the CRM in (super admin):
 *  exactly these, all among the stores they belong to. */
export async function setUserCrm(userId: number, storeIds: number[]): Promise<TeamMember> {
  const user = await request<ApiUser>(`/api/users/${userId}/crm`, {
    method: "PUT",
    body: JSON.stringify({ store_ids: storeIds }),
  });
  return mapTeamMember(user);
}

/** Replace a user's store memberships (super admin). */
export async function setUserMemberships(
  userId: number,
  memberships: { storeId: number; role: StoreRole }[]
): Promise<TeamMember> {
  const user = await request<ApiUser>(`/api/users/${userId}/memberships`, {
    method: "PUT",
    body: JSON.stringify({
      memberships: memberships.map((m) => ({ store_id: m.storeId, role: m.role })),
    }),
  });
  return mapTeamMember(user);
}

// ---- Stores ----

/** The stores the signed-in user may open: what the switcher lists. */
export async function getMyStores(): Promise<StoreAccess[]> {
  const rows = await request<
    {
      store_id: number;
      slug: string;
      name: string;
      subtitle: string | null;
      role: string;
      template: string;
      crm?: boolean;
      production?: "admin" | "write" | null;
    }[]
  >("/api/me/stores");
  return rows.map((r) => ({
    storeId: r.store_id,
    slug: r.slug,
    name: r.name,
    subtitle: r.subtitle ?? null,
    role: r.role,
    template: r.template,
    crm: r.crm ?? false,
    production: r.production ?? null,
  }));
}

export type Store = {
  id: number;
  slug: string;
  name: string;
  /** Shown after the name in the admin ("Nature Bazar — Ecotine"); null = none. */
  subtitle: string | null;
  template: string;
  currency: string;
  /** "NB" in "NB-1042"; unique across stores. */
  orderPrefix: string;
  theme: Record<string, string>;
  isActive: boolean;
  /** Set while the store is archived (always inactive then); null otherwise. */
  archivedAt: string | null;
  domains: string[];
  primaryDomain: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiStore = {
  id: number;
  slug: string;
  name: string;
  subtitle: string | null;
  template: string;
  currency: string;
  order_prefix: string;
  theme: Record<string, string>;
  is_active: boolean;
  archived_at?: string | null;
  domains: string[];
  primary_domain: string | null;
  created_at: string;
  updated_at: string;
};

function mapStore(s: ApiStore): Store {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    subtitle: s.subtitle ?? null,
    template: s.template,
    currency: s.currency,
    orderPrefix: s.order_prefix,
    theme: s.theme ?? {},
    isActive: s.is_active,
    archivedAt: s.archived_at ?? null,
    domains: s.domains,
    primaryDomain: s.primary_domain,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export type StoreInput = {
  slug?: string;
  name: string;
  /** "" clears it. */
  subtitle: string;
  template: string;
  currency: string;
  orderPrefix: string;
  theme: Record<string, string>;
  domains: string[];
  isActive: boolean;
};

function storeBody(input: StoreInput) {
  return {
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    name: input.name,
    subtitle: input.subtitle,
    template: input.template,
    currency: input.currency,
    order_prefix: input.orderPrefix,
    theme: input.theme,
    domains: input.domains,
    is_active: input.isActive,
  };
}

export async function listStores(): Promise<Store[]> {
  return (await request<ApiStore[]>("/api/stores")).map(mapStore);
}

/** What a live probe of one of a store's domains found. */
export type DomainStatus =
  | "ok"
  | "not_published"
  | "wrong_store"
  | "unreachable"
  | "tls_error"
  | "http_error";

export type DomainHealth = {
  host: string;
  isPrimary: boolean;
  /** The hostname is in store_domains (always true for a store's own rows). */
  resolved: boolean;
  resolvedStoreId: number | null;
  status: DomainStatus;
  /** One line for the tooltip. */
  detail: string;
  httpStatus: number | null;
  /** The store the hostname actually answered for, when it named one. */
  reachedStoreSlug: string | null;
};

/**
 * Whether a store's domains really serve it. Deliberately separate from
 * `Store.isActive`, which is only what our own row says: a store can be
 * Active with its DNS still pointing at the old host.
 */
export type StoreHealth = {
  storeId: number;
  isActive: boolean;
  domains: DomainHealth[];
};

type ApiDomainHealth = {
  host: string;
  is_primary: boolean;
  resolved: boolean;
  resolved_store_id: number | null;
  status: DomainStatus;
  detail: string;
  http_status: number | null;
  reached_store_slug: string | null;
};

/** Probes the store's domains server-side; slow by nature, so callers fetch
 *  it after the list is on screen rather than before. */
export async function getStoreHealth(
  storeId: number,
  refresh = false
): Promise<StoreHealth> {
  const res = await request<{
    store_id: number;
    is_active: boolean;
    domains: ApiDomainHealth[];
  }>(`/api/stores/${storeId}/health${refresh ? "?refresh=true" : ""}`);
  return {
    storeId: res.store_id,
    isActive: res.is_active,
    domains: res.domains.map((d) => ({
      host: d.host,
      isPrimary: d.is_primary,
      resolved: d.resolved,
      resolvedStoreId: d.resolved_store_id,
      status: d.status,
      detail: d.detail,
      httpStatus: d.http_status,
      reachedStoreSlug: d.reached_store_slug,
    })),
  };
}

export async function listTemplates(): Promise<string[]> {
  return request<string[]>("/api/stores/templates");
}

export async function createStore(input: StoreInput): Promise<Store> {
  return mapStore(
    await request<ApiStore>("/api/stores", {
      method: "POST",
      body: JSON.stringify(storeBody(input)),
    })
  );
}

export async function updateStore(id: number, input: StoreInput): Promise<Store> {
  const { slug: _slug, ...rest } = storeBody(input);
  void _slug;
  return mapStore(
    await request<ApiStore>(`/api/stores/${id}`, {
      method: "PATCH",
      body: JSON.stringify(rest),
    })
  );
}

/** Archive an inactive store (super admin). Nothing is deleted. */
export async function archiveStore(id: number): Promise<Store> {
  return mapStore(await request<ApiStore>(`/api/stores/${id}/archive`, { method: "POST" }));
}

/** Bring an archived store back; it stays inactive until switched on. */
export async function restoreStore(id: number): Promise<Store> {
  return mapStore(await request<ApiStore>(`/api/stores/${id}/restore`, { method: "POST" }));
}

/** Current session's user, or null when not signed in. */
export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return mapAuthUser(await res.json());
}

export async function loginWithGoogle(credential: string): Promise<AuthUser> {
  const user = await request<ApiUser>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
  return mapAuthUser(user);
}

export type AuthProviders = {
  google: boolean;
  /** The Google OAuth client id, a runtime value from the API. "" when off. */
  googleClientId: string;
  dev: boolean;
};

/** Which sign-in buttons to show, and the Google client id to use. `dev` is
 * only ever true on a dev server. Null while unknown (API unreachable). */
export async function getAuthProviders(): Promise<AuthProviders | null> {
  try {
    const p = await request<{ google: boolean; google_client_id: string; dev: boolean }>(
      "/api/auth/providers"
    );
    return { google: p.google, googleClientId: p.google_client_id, dev: p.dev };
  } catch {
    return null;
  }
}

/** Development only: sign in as the server's DEV_LOGIN_EMAIL account. */
export async function devLogin(): Promise<AuthUser> {
  const user = await request<ApiUser>("/api/auth/dev-login", { method: "POST" });
  return mapAuthUser(user);
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function listUsers(): Promise<TeamMember[]> {
  const users = await request<ApiUser[]>("/api/users");
  return users.map(mapTeamMember);
}

export async function updateUser(
  id: number,
  patch: { status?: UserStatus; role?: UserRole; nickname?: string }
): Promise<TeamMember> {
  const user = await request<ApiUser>(`/api/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return mapTeamMember(user);
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API ${res.status}`);
}

// ---------------------------------------------------------------- system

export type TrafficTotals = {
  requests: number;
  throttled: number;
  cooldown: number;
  client_errors: number;
  server_errors: number;
  latency_ms: number;
  avg_latency_ms: number;
};

export type TrafficPoint = Omit<TrafficTotals, "avg_latency_ms"> & {
  minute: string;
};

export type LimiterSnapshot = {
  name: string;
  limit: number;
  window_seconds: number;
  tracked_ips: number;
  blocked_now: number;
  blocked_ips: string[];
  seen_blind_requests: boolean;
};

export type LogEntry = {
  time: string;
  level: string;
  logger: string;
  worker: string;
  message: string;
};

export type OrderFlow = {
  orders_placed: number;
  forms_captured: number;
  confirmed: number;
  cancelled: number;
};

export type VisitorPeriod = {
  key: "today" | "last_7d" | "last_30d";
  label: string;
  since: string;
  page_views: number;
  visitors: number;
  orders: number;
  /** Web orders per hundred visitors; null when nobody visited. */
  conversion_pct: number | null;
};

export type SystemOverview = {
  generated_at: string;
  visitors: {
    periods: VisitorPeriod[];
    /** When visit counting began; null until the first page view lands. */
    since: string | null;
    retain_days: number;
  };
  database: {
    ok: boolean;
    latency_ms: number;
    size_bytes: number;
    version: string;
    pool: { size: number; in_use: number; overflow: number; max_overflow: number };
  };
  traffic: {
    per_minute: TrafficPoint[];
    last_hour: TrafficTotals;
    last_24h: TrafficTotals;
    flush_every_seconds: number;
  };
  orders: {
    flow: { last_hour: OrderFlow; last_24h: OrderFlow };
    by_status: Record<string, number>;
    total: number;
    pending_signins: number;
  };
  rate_limits: {
    limiters: LimiterSnapshot[];
    order_cooldown_hours: number;
    client_ip_header: string;
  };
  request: {
    client_ip: string | null;
    client_ip_visible: boolean;
    client_ip_header: string;
    client_ip_header_present: boolean;
    via_cloudflare: boolean;
    country: string | null;
  };
  server: {
    load: [number, number, number];
    cpus: number;
    memory_total: number | null;
    memory_available: number | null;
    disk_total: number;
    disk_free: number;
  };
  process: {
    worker: string;
    started_at: string;
    uptime_seconds: number;
    workers_configured: number;
    python: string;
  };
  integrations: {
    meta_pixel: boolean;
    meta_capi: boolean;
    meta_test_mode: boolean;
    // Conversions API events Meta never accepted, parked for a resend, and
    // deliveries this worker still has in flight.
    meta_capi_failed: number;
    meta_capi_pending: number;
    google_login: boolean;
    secure_cookies: boolean;
  };
  recent_logs: LogEntry[];
};

/** Super admin only: everything the System page shows, in one call. */
export function getSystemOverview(): Promise<SystemOverview> {
  return request<SystemOverview>("/api/system/overview");
}

export type CapiResendResult = { sent: number; failed: number; remaining: number };

/** Super admin only: try the parked Conversions API events once more. */
export function resendFailedCapiEvents(): Promise<CapiResendResult> {
  return request<CapiResendResult>("/api/system/capi/failed/resend", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// --- Products ---------------------------------------------------------------

type ApiVariant = {
  id: number;
  product_id: number;
  label: string;
  image_url: string | null;
  default_quantity: number;
  unit_price: number;
  sku: string;
  is_default: boolean;
};

type ApiProduct = {
  id: number;
  title: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  variants: ApiVariant[];
};

function mapVariant(v: ApiVariant): Variant {
  return {
    id: v.id,
    productId: v.product_id,
    label: v.label,
    imageUrl: v.image_url,
    defaultQuantity: v.default_quantity,
    unitPrice: v.unit_price,
    sku: v.sku,
    isDefault: v.is_default,
  };
}

function mapProduct(p: ApiProduct): Product {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    isActive: p.is_active,
    variants: p.variants.map(mapVariant),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** One version as the editor sends it: an id to update, or null for new. */
export type VariantSaveInput = {
  id: number | null;
  label: string;
  defaultQuantity: number;
  unitPrice: number;
  sku: string;
  isDefault: boolean;
};

/** The whole product as the editor holds it. */
export type ProductSaveInput = {
  title: string;
  description: string;
  variants: VariantSaveInput[];
};

/**
 * The store's products. By default the store the admin shell is working in;
 * `storeId` names another one, for the super admin editing a store they have
 * not switched to (the header override wins over the shell's choice).
 */
export async function listProducts(storeId?: number): Promise<Product[]> {
  const init = storeId === undefined ? undefined : { headers: { "X-Admin-Store": String(storeId) } };
  return (await request<ApiProduct[]>("/api/products", init)).map(mapProduct);
}

/**
 * Save a product — name, versions and description — in one request and one
 * transaction. Versions left out of the list are deleted. Answers with the
 * product and the versions' ids in the order they were sent, so a picture
 * can be attached to a row that did not exist before the save.
 */
export async function saveProduct(
  input: ProductSaveInput,
  id: number | null
): Promise<{ product: Product; variantIds: number[] }> {
  const body = JSON.stringify({
    title: input.title,
    description: input.description,
    variants: input.variants.map((v) => ({
      id: v.id,
      label: v.label,
      default_quantity: v.defaultQuantity,
      unit_price: v.unitPrice,
      sku: v.sku,
      is_default: v.isDefault,
    })),
  });
  const out = await request<{ product: ApiProduct; variant_ids: number[] }>(
    id === null ? "/api/products" : `/api/products/${id}`,
    { method: id === null ? "POST" : "PUT", body }
  );
  return { product: mapProduct(out.product), variantIds: out.variant_ids };
}

/** Make one product the live one. Returns the whole list, already re-ordered. */
export async function activateProduct(id: number): Promise<Product[]> {
  return (
    await request<ApiProduct[]>(`/api/products/${id}/activate`, {
      method: "POST",
    })
  ).map(mapProduct);
}

export async function deleteProduct(id: number): Promise<void> {
  await requestVoid(`/api/products/${id}`, { method: "DELETE" });
}

/**
 * Upload a variant's image. Sent as multipart, so this bypasses `request` —
 * that helper forces a JSON content type, and the browser has to set its own
 * multipart boundary here.
 */
export async function uploadVariantImage(
  productId: number,
  variantId: number,
  file: File
): Promise<Product> {
  const form = new FormData();
  form.append("file", file);
  return mapProduct(
    await requestForm<ApiProduct>(
      `/api/products/${productId}/variants/${variantId}/image`,
      form
    )
  );
}


// --- Manual orders ----------------------------------------------------------

export type ManualOrderInput = {
  customerName: string;
  phone: string;
  address: string;
  items: { variantId: number; quantity: number; unitPriceOverride?: number }[];
  comment?: string;
  /** true drops it straight into Confirmed; false leaves it on Web Order List. */
  approved: boolean;
  /** A total staff negotiated on the phone, overriding the catalogue sum. */
  totalOverride?: number;
  /** Where Pathao delivers, as the parser filled it in or staff picked it. */
  pathaoLocation?: PathaoLocation;
};

/**
 * Create an order on the customer's behalf. Prices come from the catalogue
 * unless a line carries a staff-typed unitPriceOverride (a discount agreed on
 * the phone) — the API validates and bounds it, so a tampered browser still
 * can't set its own total.
 */
export async function createManualOrder(
  input: ManualOrderInput
): Promise<Order> {
  return mapOrder(
    await request<ApiOrder>("/api/orders/manual", {
      method: "POST",
      body: JSON.stringify({
        customer_name: input.customerName,
        phone: input.phone,
        address: input.address,
        items: input.items.map((i) => ({
          variant_id: i.variantId,
          quantity: i.quantity,
          unit_price_override: i.unitPriceOverride ?? null,
        })),
        comment: input.comment ?? "",
        approved: input.approved,
        total_override: input.totalOverride ?? null,
        pathao_location: input.pathaoLocation
          ? locationBody(input.pathaoLocation)
          : null,
      }),
    })
  );
}

export type PhoneLookup = {
  /** Orders this number actually placed. */
  orders: Order[];
  /** Storefront forms this number filled in but never submitted. */
  incomplete: Order[];
};

/**
 * What this number has done before. Informational only — it never stops staff
 * taking another order, it just lets them say "this one is already on its way"
 * before the customer repeats themselves.
 *
 * Abandoned forms come back separately: nothing was ordered, so it is a lead
 * to close rather than a delivery to explain.
 *
 * These are whole orders, not summaries, so opening one from the results costs
 * no extra request.
 */
export async function lookupOrdersByPhone(
  phone: string
): Promise<PhoneLookup> {
  const data = await request<{
    phone: string;
    orders: ApiOrder[];
    incomplete: ApiOrder[];
  }>(`/api/orders/lookup?phone=${encodeURIComponent(phone)}`);

  return {
    orders: (data.orders ?? []).map(mapOrder),
    incomplete: (data.incomplete ?? []).map(mapOrder),
  };
}

// ---- Store settings (integrations; secrets never come back) ----

export type StoreSettings = {
  metaPixelId: string;
  metaTestEventCode: string;
  metaCapiTokenSet: boolean;
  metaCapiTokenHint: string | null;
  pathaoClientId: string;
  pathaoClientSecretSet: boolean;
  pathaoClientSecretHint: string | null;
  pathaoEmail: string;
  pathaoPasswordSet: boolean;
  pathaoStoreId: number | null;
  pathaoItemType: "document" | "parcel" | "fragile";
  pathaoParcelWeightKg: string;
  bdcourierApiKeySet: boolean;
  bdcourierApiKeyHint: string | null;
  encryptionAvailable: boolean;
};

type ApiStoreSettings = {
  meta_pixel_id: string;
  meta_test_event_code: string;
  meta_capi_token_set: boolean;
  meta_capi_token_hint: string | null;
  pathao_client_id: string;
  pathao_client_secret_set: boolean;
  pathao_client_secret_hint: string | null;
  pathao_email: string;
  pathao_password_set: boolean;
  pathao_store_id: number | null;
  pathao_item_type: "document" | "parcel" | "fragile";
  pathao_parcel_weight_kg: string | number;
  bdcourier_api_key_set: boolean;
  bdcourier_api_key_hint: string | null;
  encryption_available: boolean;
};

function mapSettings(s: ApiStoreSettings): StoreSettings {
  return {
    metaPixelId: s.meta_pixel_id,
    metaTestEventCode: s.meta_test_event_code,
    metaCapiTokenSet: s.meta_capi_token_set,
    metaCapiTokenHint: s.meta_capi_token_hint,
    pathaoClientId: s.pathao_client_id,
    pathaoClientSecretSet: s.pathao_client_secret_set,
    pathaoClientSecretHint: s.pathao_client_secret_hint,
    pathaoEmail: s.pathao_email,
    pathaoPasswordSet: s.pathao_password_set,
    pathaoStoreId: s.pathao_store_id,
    pathaoItemType: s.pathao_item_type,
    pathaoParcelWeightKg: String(s.pathao_parcel_weight_kg),
    bdcourierApiKeySet: s.bdcourier_api_key_set,
    bdcourierApiKeyHint: s.bdcourier_api_key_hint,
    encryptionAvailable: s.encryption_available,
  };
}

/** Secret fields: undefined keeps the stored value, "" clears it, text sets it. */
export type StoreSettingsInput = {
  metaPixelId: string;
  metaCapiToken?: string;
  metaTestEventCode: string;
  pathaoClientId: string;
  pathaoClientSecret?: string;
  pathaoEmail: string;
  pathaoPassword?: string;
  pathaoStoreId: number | null;
  pathaoItemType: "document" | "parcel" | "fragile";
  pathaoParcelWeightKg: string;
  bdcourierApiKey?: string;
};

export async function getStoreSettings(storeId: number): Promise<StoreSettings> {
  return mapSettings(await request<ApiStoreSettings>(`/api/stores/${storeId}/settings`));
}

export async function saveStoreSettings(
  storeId: number,
  input: StoreSettingsInput
): Promise<StoreSettings> {
  return mapSettings(
    await request<ApiStoreSettings>(`/api/stores/${storeId}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        meta_pixel_id: input.metaPixelId,
        meta_capi_token: input.metaCapiToken ?? null,
        meta_test_event_code: input.metaTestEventCode,
        pathao_client_id: input.pathaoClientId,
        pathao_client_secret: input.pathaoClientSecret ?? null,
        pathao_email: input.pathaoEmail,
        pathao_password: input.pathaoPassword ?? null,
        pathao_store_id: input.pathaoStoreId,
        pathao_item_type: input.pathaoItemType,
        pathao_parcel_weight_kg: input.pathaoParcelWeightKg,
        bdcourier_api_key: input.bdcourierApiKey ?? null,
      }),
    })
  );
}

// ---- Store content (the template's pictures, per store) ----

export type StoreContent = { template: string; content: Record<string, string> };

export async function getStoreContent(storeId: number): Promise<StoreContent> {
  return request<StoreContent>(`/api/stores/${storeId}/content`);
}

/** Replace the template's default picture for `key` with a file. */
export async function uploadStoreImage(
  storeId: number,
  key: string,
  file: File
): Promise<StoreContent> {
  const body = new FormData();
  body.append("file", file);
  return requestForm<StoreContent>(`/api/stores/${storeId}/content/${key}`, body, "PUT");
}

/** Back to the template's default picture for `key`. */
export async function resetStoreImage(storeId: number, key: string): Promise<StoreContent> {
  return request<StoreContent>(`/api/stores/${storeId}/content/${key}`, { method: "DELETE" });
}

// ---- Pathao connection test (saved credentials) ----

export type PathaoTest = {
  enabled: boolean;
  sandbox: boolean;
  baseUrl: string;
  storeId: number;
  stores: { id: number; name: string; address: string }[];
  error: string | null;
};

export async function testPathao(storeId: number): Promise<PathaoTest> {
  const r = await request<{
    enabled: boolean;
    sandbox: boolean;
    base_url: string;
    store_id: number;
    stores: Record<string, unknown>[];
    error: string | null;
  }>(`/api/stores/${storeId}/settings/pathao-test`, { method: "POST" });
  return {
    enabled: r.enabled,
    sandbox: r.sandbox,
    baseUrl: r.base_url,
    storeId: r.store_id,
    stores: r.stores.map((s) => ({
      id: Number(s.store_id ?? s.id ?? 0),
      name: String(s.store_name ?? s.name ?? ""),
      address: String(s.store_address ?? s.address ?? ""),
    })),
    error: r.error,
  };
}

// ---- BDCourier ----

/** The customer's courier history for a phone (manual order form). 503
 * when the store has no BDCourier key: callers treat that as "no data". */
export async function getFraudCheck(phone: string): Promise<FraudCheck | null> {
  const data = await request<ApiFraudCheck>(
    `/api/orders/fraud-check?phone=${encodeURIComponent(phone)}`
  );
  return mapFraud(data);
}

/** Ask BDCourier again for an order's phone and pin the answer to the order. */
export async function recheckOrderFraud(
  orderId: number,
  force = true
): Promise<Order> {
  return mapOrder(
    await request<ApiOrder>(
      `/api/orders/${orderId}/fraud-check?force=${force}`,
      { method: "POST" }
    )
  );
}

// ---- Expenses (CRM) ----

export type PaymentMethod = "cash" | "bkash" | "nagad" | "bank_transfer" | "card" | "other";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

export type Expense = {
  id: number;
  /** Stamped by the server when the expense was added. */
  spent_at: string;
  category: string;
  item: string;
  amount: number;
  payment_method: PaymentMethod;
  note: string | null;
  added_by_name: string;
  added_by_id: number | null;
  /** Receipts or screenshots attached, kept in Google Drive. */
  proof_count: number;
  /** Which ones, oldest first (the table shows the first as a thumbnail). */
  proofs: { id: number; mime_type: string }[];
};

/** What the drawer sends. No date: the server stamps it. added_by_name is
 *  honoured for a super admin only. */
export type ExpenseInput = {
  category: string;
  item: string;
  amount: number;
  payment_method: PaymentMethod;
  note?: string | null;
  added_by_name?: string | null;
};

/** icon is a key from components/admin/expense-icons.tsx. id is null for
 *  the defaults, which cannot be removed. */
export type ExpenseCategory = {
  id: number | null;
  name: string;
  icon: string;
  default: boolean;
};

/** Removes one of the store's own categories; returns the whole list. */
export async function deleteExpenseCategory(id: number): Promise<ExpenseCategory[]> {
  return request<ExpenseCategory[]>(`/api/expenses/categories/${id}`, { method: "DELETE" });
}

export type ExpenseAmount = { label: string; amount: number };

export type ExpenseSummary = {
  day: string;
  day_total: number;
  day_count: number;
  previous_day_total: number;
  /** This month, 1st to today — whatever `day` is — against the same days of last month. */
  month_total: number;
  previous_month_total: number;
  by_category: ExpenseAmount[];
};

/** Total spent each of the `days` days ending on `day`, oldest first, empty
 *  days included as 0; label is the date. */
export async function getExpenseTrend(day: string, days: number): Promise<ExpenseAmount[]> {
  return request<ExpenseAmount[]>(`/api/expenses/trend?day=${day}&days=${days}`);
}

export async function listExpenses(day: string): Promise<Expense[]> {
  return request<Expense[]>(`/api/expenses?day=${day}`);
}

export async function getExpenseSummary(day: string): Promise<ExpenseSummary> {
  return request<ExpenseSummary>(`/api/expenses/summary?day=${day}`);
}

export async function addExpense(input: ExpenseInput): Promise<Expense> {
  return request<Expense>("/api/expenses", { method: "POST", body: JSON.stringify(input) });
}

export async function editExpense(id: number, input: ExpenseInput): Promise<Expense> {
  return request<Expense>(`/api/expenses/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteExpense(id: number): Promise<void> {
  await requestVoid(`/api/expenses/${id}`, { method: "DELETE" });
}

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  return request<ExpenseCategory[]>("/api/expenses/categories");
}

/** Adds a category; returns the store's whole list. */
export async function addExpenseCategory(
  name: string,
  icon: string
): Promise<ExpenseCategory[]> {
  return request<ExpenseCategory[]>("/api/expenses/categories", {
    method: "POST",
    body: JSON.stringify({ name, icon }),
  });
}

// ---- Expense proofs (Google Drive) ----

export type ExpenseProof = {
  id: number;
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
};

export async function listExpenseProofs(expenseId: number): Promise<ExpenseProof[]> {
  return request<ExpenseProof[]>(`/api/expenses/${expenseId}/proofs`);
}

/** Attaches files to an expense (stored in Drive); returns all its proofs. */
export async function uploadExpenseProofs(
  expenseId: number,
  files: File[]
): Promise<ExpenseProof[]> {
  const body = new FormData();
  for (const f of files) body.append("files", f);
  return requestForm<ExpenseProof[]>(`/api/expenses/${expenseId}/proofs`, body);
}

export async function deleteExpenseProof(proofId: number): Promise<void> {
  await requestVoid(`/api/expenses/proofs/${proofId}`, { method: "DELETE" });
}

/** The proof file itself, for showing in the admin only (see requestBlob). */
export async function getExpenseProofFile(proofId: number): Promise<Blob> {
  return requestBlob(`/api/expenses/proofs/${proofId}/file`);
}

/** A small preview of a proof (photos and PDFs), for the table. */
export async function getExpenseProofThumb(proofId: number): Promise<Blob> {
  return requestBlob(`/api/expenses/proofs/${proofId}/thumb`);
}

// ---- Google Drive connection (super admin) ----

export type DriveStatus = {
  /** The OAuth client is set in the server's environment. */
  configured: boolean;
  connected: boolean;
  account_email: string | null;
  root_folder: string;
  connected_at: string | null;
};

export async function getDriveStatus(): Promise<DriveStatus> {
  return request<DriveStatus>("/api/drive/status");
}

/** Google's consent page to send the browser to. */
export async function connectDrive(): Promise<string> {
  return (await request<{ url: string }>("/api/drive/connect", { method: "POST" })).url;
}

export async function disconnectDrive(): Promise<void> {
  await requestVoid("/api/drive/disconnect", { method: "POST" });
}

// ---- Sending a proof from a phone (QR code) ----

export type DropFile = { id: number; filename: string; mime_type: string; size: number };

export type ProofDrop = { id: number; expires_at: string; files: DropFile[] };

/** A new phone-upload link; `token` is the secret for the QR code, given
 *  only here. */
export async function createProofDrop(): Promise<ProofDrop & { token: string }> {
  return request<ProofDrop & { token: string }>("/api/proof-drops", { method: "POST" });
}

export async function getProofDrop(dropId: number): Promise<ProofDrop> {
  return request<ProofDrop>(`/api/proof-drops/${dropId}`);
}

export async function getProofDropThumb(dropId: number, fileId: number): Promise<Blob> {
  return requestBlob(`/api/proof-drops/${dropId}/files/${fileId}/thumb`);
}

export async function removeProofDropFile(dropId: number, fileId: number): Promise<void> {
  await requestVoid(`/api/proof-drops/${dropId}/files/${fileId}`, { method: "DELETE" });
}

/** Files the phone's pictures with a saved expense. */
export async function attachProofDrop(dropId: number, expenseId: number): Promise<ExpenseProof[]> {
  return request<ExpenseProof[]>(`/api/proof-drops/${dropId}/attach/${expenseId}`, {
    method: "POST",
  });
}

export async function discardProofDrop(dropId: number): Promise<void> {
  await requestVoid(`/api/proof-drops/${dropId}`, { method: "DELETE" });
}

/** The phone page's view of a drop (no sign-in; the link is the key). */
export type DropInfo = {
  store_name: string;
  expires_at: string;
  received: number;
  max_files: number;
  max_bytes: number;
};

// ---- Production cost (CRM) ----

/** Times are "HH:MM" going in and "HH:MM:SS" coming back. */
export type ProductionShift = { starts: string; ends: string; cooks: number | null };

export type ProductionMaterial = {
  item: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  /** Worked out by the server: quantity × unit price, or the lump sum. */
  amount: number;
};

export type ProductionBatch = {
  product: string;
  patils: number;
  jars_per_patil: number;
  jars: number;
};

export type ProductionMisc = { purpose: string; amount: number; note: string | null };

/** A production day as saved; every total was worked out by the server. */
export type ProductionDay = {
  day: string;
  starts_at: string | null;
  ends_at: string | null;
  shifts: ProductionShift[];
  male_cooks: number;
  male_rate: number;
  female_cooks: number;
  female_rate: number;
  gas_cost: number;
  packaging_cost: number;
  note: string | null;
  materials: ProductionMaterial[];
  batches: ProductionBatch[];
  misc: ProductionMisc[];
  materials_cost: number;
  labour_cost: number;
  misc_cost: number;
  total_cost: number;
  patils: number;
  jars: number;
  cost_per_jar: number;
  updated_at: string;
};

/** What the drawer sends. No totals: the server works them out. A material
 *  line names one of the store's items (the server adds its unit) and gives
 *  quantity and that day's unit_price, or a lump-sum amount. */
export type ProductionDayInput = {
  starts_at: string | null;
  ends_at: string | null;
  shifts: ProductionShift[];
  male_cooks: number;
  male_rate: number;
  female_cooks: number;
  female_rate: number;
  gas_cost: number;
  packaging_cost: number;
  materials: {
    item: string;
    quantity: string | null;
    unit_price: number | null;
    amount: number | null;
  }[];
  batches: { product: string; patils: number; jars_per_patil: number }[];
  misc: { purpose: string; amount: number; note: string | null }[];
  note: string | null;
};

export type ProductionDaySummary = {
  day: string;
  products: number;
  /** What was cooked, in the order entered. */
  product_names: string[];
  patils: number;
  jars: number;
  total_cost: number;
  cost_per_jar: number;
};

/** Something the store cooks. icon is a key from
 *  components/admin/production/product-icons.tsx. */
export type ProductionProduct = { id: number; name: string; icon: string };

export const PRODUCTION_UNITS = ["kg", "g", "L", "ml", "pcs", "dozen", "packet", "bottle"] as const;
export type ProductionUnit = (typeof PRODUCTION_UNITS)[number];

/** How a unit reads on screen. The API stores and checks the code; the
 *  admin shows the bazar in Bangla. */
export const UNIT_LABELS: Record<ProductionUnit, string> = {
  kg: "কেজি",
  g: "গ্রাম",
  L: "লিটার",
  ml: "মিলি",
  pcs: "পিস",
  dozen: "ডজন",
  packet: "প্যাকেট",
  bottle: "বোতল",
};

/** A unit code in Bangla; an unknown code (a newer API) shows as it is. */
export function unitLabel(unit: string | null | undefined): string {
  return unit ? (UNIT_LABELS[unit as ProductionUnit] ?? unit) : "";
}

/** A raw material the store buys: a name and its unit, no price (each day
 *  records what it paid). */
export type ProductionItem = { id: number; name: string; unit: ProductionUnit };

export type ProductionSuggestions = { purposes: string[] };

/** The day as saved, or null when it is not a production day. */
export async function getProductionDay(day: string): Promise<ProductionDay | null> {
  return request<ProductionDay | null>(`/api/production/days/${day}`);
}

/** Production days, newest first, between start and end (inclusive). */
export async function listProductionDays(opts: {
  start?: string;
  end?: string;
  limit?: number;
}): Promise<ProductionDaySummary[]> {
  const q = new URLSearchParams();
  if (opts.start) q.set("start", opts.start);
  if (opts.end) q.set("end", opts.end);
  if (opts.limit) q.set("limit", String(opts.limit));
  return request<ProductionDaySummary[]>(`/api/production/days?${q}`);
}

/** Records the day's production, or replaces it. With fromDay, the
 *  production saved on that date is moved to `day` (super admin only). */
export async function saveProductionDay(
  day: string,
  input: ProductionDayInput,
  fromDay?: string
): Promise<ProductionDay> {
  const move = fromDay && fromDay !== day ? `?from_day=${fromDay}` : "";
  return request<ProductionDay>(`/api/production/days/${day}${move}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Makes the day an ordinary day again. */
export async function deleteProductionDay(day: string): Promise<void> {
  await requestVoid(`/api/production/days/${day}`, { method: "DELETE" });
}

export async function listProductionProducts(): Promise<ProductionProduct[]> {
  return request<ProductionProduct[]>("/api/production/products");
}

/** Adds a product, or edits one when id is given; returns the whole list. */
export async function saveProductionProduct(
  input: { name: string; icon: string },
  id?: number
): Promise<ProductionProduct[]> {
  return request<ProductionProduct[]>(
    id === undefined ? "/api/production/products" : `/api/production/products/${id}`,
    { method: id === undefined ? "POST" : "PUT", body: JSON.stringify(input) }
  );
}

/** Removes a product; returns the whole list. */
export async function deleteProductionProduct(id: number): Promise<ProductionProduct[]> {
  return request<ProductionProduct[]>(`/api/production/products/${id}`, { method: "DELETE" });
}

export async function listProductionItems(): Promise<ProductionItem[]> {
  return request<ProductionItem[]>("/api/production/items");
}

/** Adds a raw material, or edits one when id is given; returns the whole list. */
export async function saveProductionItem(
  input: { name: string; unit: ProductionUnit },
  id?: number
): Promise<ProductionItem[]> {
  return request<ProductionItem[]>(
    id === undefined ? "/api/production/items" : `/api/production/items/${id}`,
    { method: id === undefined ? "POST" : "PUT", body: JSON.stringify(input) }
  );
}

/** Removes a raw material; returns the whole list. */
export async function deleteProductionItem(id: number): Promise<ProductionItem[]> {
  return request<ProductionItem[]>(`/api/production/items/${id}`, { method: "DELETE" });
}

export async function getProductionSuggestions(): Promise<ProductionSuggestions> {
  return request<ProductionSuggestions>("/api/production/suggestions");
}

/** A member of the store, and what they may do on the Production pages. */
export type ProductionMember = {
  user_id: number;
  name: string;
  email: string;
  picture_url: string | null;
  role: string;
  /** "admin" by address (PRODUCTION_ADMIN_EMAILS), "write", or null. */
  level: "admin" | "write" | null;
};

/** The store's members and their Production access (production admins only). */
export async function listProductionAccess(): Promise<ProductionMember[]> {
  return request<ProductionMember[]>("/api/production/access");
}

/** Lets a member record productions, or stops them; returns the list. */
export async function setProductionAccess(
  userId: number,
  write: boolean
): Promise<ProductionMember[]> {
  return request<ProductionMember[]>(`/api/production/access/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ write }),
  });
}

/** A production as a PDF report, made on the server from the Word template. */
export async function getProductionReport(day: string): Promise<Blob> {
  return requestBlob(`/api/production/days/${day}/report`);
}
