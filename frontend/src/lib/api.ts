import { request, requestForm, requestVoid } from "@/lib/http";
import type {
  Order,
  OrderItem,
  OrderSource,
  OrderStatus,
  OrderTag,
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
  tags: {
    id: number;
    label: string;
    created_by_name: string | null;
    created_by_nickname: string | null;
  }[];
  items: ApiOrderItem[];
};

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

export async function listOrders(
  params: OrderListParams
): Promise<OrderListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("page_size", String(params.pageSize));
  for (const status of params.status ?? []) search.append("status", status);
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
};

/** The home page's figures for a range of Dhaka days and the month it ends in. */
export async function getDashboard(from: string, to: string): Promise<Dashboard> {
  return request<Dashboard>(`/api/orders/dashboard?from=${from}&to=${to}`);
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
  to: string
): Promise<Activity[]> {
  return request<Activity[]>(
    `/api/orders/dashboard/activity?user_id=${userId}&from=${from}&to=${to}`
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

type ApiMembership = { store_id: number; slug: string; name: string; role: StoreRole };

function mapMembership(m: ApiMembership): Membership {
  return { storeId: m.store_id, slug: m.slug, name: m.name, role: m.role };
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
    { store_id: number; slug: string; name: string; role: string }[]
  >("/api/me/stores");
  return rows.map((r) => ({ storeId: r.store_id, slug: r.slug, name: r.name, role: r.role }));
}

export type Store = {
  id: number;
  slug: string;
  name: string;
  template: string;
  currency: string;
  /** "NB" in "NB-1042"; unique across stores. */
  orderPrefix: string;
  theme: Record<string, string>;
  isActive: boolean;
  domains: string[];
  primaryDomain: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiStore = {
  id: number;
  slug: string;
  name: string;
  template: string;
  currency: string;
  order_prefix: string;
  theme: Record<string, string>;
  is_active: boolean;
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
    template: s.template,
    currency: s.currency,
    orderPrefix: s.order_prefix,
    theme: s.theme ?? {},
    isActive: s.is_active,
    domains: s.domains,
    primaryDomain: s.primary_domain,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export type StoreInput = {
  slug?: string;
  name: string;
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

export async function listProducts(): Promise<Product[]> {
  return (await request<ApiProduct[]>("/api/products")).map(mapProduct);
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
  items: { variantId: number; quantity: number }[];
  comment?: string;
  /** true drops it straight into Confirmed; false leaves it on Web Order List. */
  approved: boolean;
};

/**
 * Create an order on the customer's behalf. Only variant ids and quantities go
 * up — the API prices the cart from the catalogue, so a tampered browser can
 * never set its own total.
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
        })),
        comment: input.comment ?? "",
        approved: input.approved,
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
  fraudbdApiKeySet: boolean;
  fraudbdApiKeyHint: string | null;
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
  fraudbd_api_key_set: boolean;
  fraudbd_api_key_hint: string | null;
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
    fraudbdApiKeySet: s.fraudbd_api_key_set,
    fraudbdApiKeyHint: s.fraudbd_api_key_hint,
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
  fraudbdApiKey?: string;
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
        fraudbd_api_key: input.fraudbdApiKey ?? null,
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
