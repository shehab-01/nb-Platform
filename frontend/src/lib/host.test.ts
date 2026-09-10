import { describe, expect, it } from "vitest";

import { classifyHost, normaliseHost, validSlug } from "@/lib/host";

describe("normaliseHost", () => {
  it("lowercases and drops the port and trailing dot", () => {
    expect(normaliseHost("Store1.NB.Local:8090.")).toBe("store1.nb.local");
  });
  it("keeps IPv6 literals", () => {
    expect(normaliseHost("[::1]:8090")).toBe("::1");
  });
  it("takes the first of a comma list", () => {
    expect(normaliseHost("admin.nb.local, 10.0.0.1")).toBe("admin.nb.local");
  });
  it("returns null for nothing", () => {
    expect(normaliseHost("")).toBeNull();
    expect(normaliseHost(null)).toBeNull();
    expect(normaliseHost(":8090")).toBeNull();
  });
});

describe("classifyHost", () => {
  it("recognises the admin host regardless of case or port", () => {
    expect(classifyHost("admin.nb.local", "Admin.NB.local:8090")).toBe("admin");
  });
  it("accepts a comma-separated list of admin hosts", () => {
    expect(classifyHost("admin.nb.test", "admin.nb.local, admin.nb.test:8090")).toBe("admin");
    expect(classifyHost("store1.nb.test", "admin.nb.local,admin.nb.test")).toBe("store");
  });
  it("treats every other host as a storefront candidate", () => {
    expect(classifyHost("store1.nb.local", "admin.nb.local")).toBe("store");
    expect(classifyHost("localhost", "admin.nb.local")).toBe("store");
    expect(classifyHost(null, "admin.nb.local")).toBe("store");
  });
});

describe("validSlug", () => {
  it("accepts simple slugs", () => {
    expect(validSlug("store1")).toBe("store1");
    expect(validSlug(" Store-2 ")).toBe("store-2");
  });
  it("rejects anything else", () => {
    expect(validSlug("../etc")).toBeNull();
    expect(validSlug("")).toBeNull();
    expect(validSlug("a".repeat(41))).toBeNull();
  });
});
