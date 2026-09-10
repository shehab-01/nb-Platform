import { describe, expect, it } from "vitest";

import { pickStore, type StoreAccess } from "@/lib/admin-store";

const a: StoreAccess = { storeId: 1, slug: "a", name: "A", role: "staff" };
const b: StoreAccess = { storeId: 2, slug: "b", name: "B", role: "owner" };

describe("pickStore", () => {
  it("returns null with no stores", () => {
    expect(pickStore([], 2)).toBeNull();
  });
  it("selects the only store automatically", () => {
    expect(pickStore([b], null)).toBe(b);
    expect(pickStore([b], 99)).toBe(b);
  });
  it("prefers the remembered store when it is still accessible", () => {
    expect(pickStore([a, b], 2)).toBe(b);
  });
  it("falls back to the first when the remembered one is gone", () => {
    expect(pickStore([a, b], 7)).toBe(a);
    expect(pickStore([a, b], null)).toBe(a);
  });
});
