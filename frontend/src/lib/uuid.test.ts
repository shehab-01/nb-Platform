import { afterEach, describe, expect, it, vi } from "vitest";

import { uuid } from "@/lib/uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID when the browser offers it", () => {
    expect(uuid()).toMatch(V4);
  });

  it("falls back when randomUUID is missing (insecure context)", () => {
    vi.stubGlobal("crypto", {});
    const a = uuid();
    expect(a).toMatch(V4);
    expect(uuid()).not.toBe(a);
  });
});
