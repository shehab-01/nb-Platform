"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock3, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getAdminStoreId,
  pickStore,
  readRememberedStoreId,
  setAdminStoreId,
  type StoreAccess,
} from "@/lib/admin-store";
import { getMe, getMyStores, logout as apiLogout, type AuthUser } from "@/lib/api";

type AuthContextValue = {
  user: AuthUser;
  isSuperAdmin: boolean;
  /** Every store this user may open, as the switcher lists them. */
  stores: StoreAccess[];
  /** The store being worked in; null only for a super admin on a platform
   * with no stores yet. */
  store: StoreAccess | null;
  /** True when the current store role (or super admin) allows the action. */
  can: (permission: Permission) => boolean;
  selectStore: (storeId: number) => void;
  logout: () => Promise<void>;
};

/** Mirrors PERMISSIONS in backend api/tenancy.py. */
export type Permission =
  | "orders"
  | "catalogue.read"
  | "catalogue.write"
  | "settings"
  | "members.read"
  | "members.write";

const PERMISSIONS: Record<Permission, ReadonlySet<string>> = {
  orders: new Set(["owner", "manager", "staff"]),
  "catalogue.read": new Set(["owner", "manager", "staff"]),
  "catalogue.write": new Set(["owner", "manager"]),
  settings: new Set(["owner"]),
  "members.read": new Set(["owner", "manager"]),
  "members.write": new Set(["owner"]),
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AdminAuthProvider");
  return ctx;
}

type Gate =
  | { kind: "checking" }
  | { kind: "no-store"; user: AuthUser }
  | { kind: "ready"; user: AuthUser; stores: StoreAccess[]; store: StoreAccess | null };

/**
 * Gates the admin shell. Only an approved (active) user gets through, and only
 * once their stores are known: one store is chosen automatically, several
 * remember the last choice, none shows the waiting page. Everyone else is
 * sent to /admin/login.
 */
export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [gate, setGate] = React.useState<Gate>({ kind: "checking" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        if (me?.status !== "active") {
          router.replace("/admin/login");
          return;
        }
        const stores = await getMyStores();
        if (cancelled) return;
        const isSuperAdmin = me.role === "super_admin";
        if (stores.length === 0 && !isSuperAdmin) {
          setAdminStoreId(null);
          setGate({ kind: "no-store", user: me });
          return;
        }
        const store = pickStore(stores, readRememberedStoreId());
        // Set before anything under the provider renders, so the very first
        // data fetch already carries X-Admin-Store.
        setAdminStoreId(store?.storeId ?? null);
        setGate({ kind: "ready", user: me, stores, store });
      } catch {
        if (!cancelled) router.replace("/admin/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const logout = React.useCallback(async () => {
    await apiLogout();
    setAdminStoreId(null);
    router.replace("/admin/login");
  }, [router]);

  const selectStore = React.useCallback((storeId: number) => {
    if (storeId === getAdminStoreId()) return;
    setAdminStoreId(storeId);
    // Every page fetched its data for the previous store; a fresh load is
    // the one way to be sure nothing stale is left on screen.
    window.location.reload();
  }, []);

  if (gate.kind === "checking") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (gate.kind === "no-store") {
    return <WaitingForStore user={gate.user} onLogout={logout} />;
  }

  const { user, stores, store } = gate;
  const isSuperAdmin = user.role === "super_admin";
  const can = (permission: Permission) =>
    isSuperAdmin || (store !== null && PERMISSIONS[permission].has(store.role));

  return (
    <AuthContext.Provider
      value={{ user, isSuperAdmin, stores, store, can, selectStore, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Approved, signed in, but assigned to no store: nothing to show yet. */
function WaitingForStore({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border bg-background p-8 text-center">
        <Clock3 className="size-8 text-amber-500" />
        <h1 className="text-lg font-semibold">Waiting for a store</h1>
        <p className="text-sm text-muted-foreground">
          {user.email} is approved but not assigned to any store yet. A super
          admin has to add you to one before there is anything to see here.
        </p>
        <Button variant="outline" size="sm" onClick={() => void onLogout()}>
          Sign in with a different account
        </Button>
      </div>
    </div>
  );
}
