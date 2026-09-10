export type UserRole = "super_admin" | "staff";
/** "suspended" is what the UI calls Disabled; the API value is unchanged. */
export type UserStatus = "pending" | "active" | "suspended";

/** What a member may do inside one store (see backend api/tenancy.py). */
export type StoreRole = "owner" | "manager" | "staff";

export type Membership = {
  storeId: number;
  slug: string;
  name: string;
  role: StoreRole;
};

export const STORE_ROLE_LABELS: Record<StoreRole, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

export const STORE_ROLE_HELP: Record<StoreRole, string> = {
  owner: "Orders, products, store settings and the store's staff",
  manager: "Orders and products",
  staff: "Orders only",
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Disabled",
};

export type TeamMember = {
  id: number;
  email: string;
  name: string;
  /** Short working name set by a super admin; overrides `name` in the UI. */
  nickname: string | null;
  pictureUrl: string | null;
  role: UserRole;
  status: UserStatus;
  joinedAt: string;
  lastActiveAt: string | null;
  ordersConfirmed: number;
  ordersShipped: number;
  /** Super admin by server configuration; the role cannot be changed here. */
  pinned: boolean;
  /** Stores this person may open, with their role in each. */
  memberships: Membership[];
};

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  staff: "Member",
};
