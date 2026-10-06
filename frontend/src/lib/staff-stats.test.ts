import { describe, expect, it } from "vitest";

import { incentiveFor, returnRate, ZERO } from "./staff-stats";

describe("incentiveFor", () => {
  it("pays nothing under 100 delivered", () => {
    expect(incentiveFor(0)).toBe(0);
    expect(incentiveFor(99)).toBe(0);
  });

  it("pays each tier from its threshold", () => {
    expect(incentiveFor(100)).toBe(1000);
    expect(incentiveFor(149)).toBe(1000);
    expect(incentiveFor(150)).toBe(1750);
    expect(incentiveFor(199)).toBe(1750);
    expect(incentiveFor(200)).toBe(3000);
  });

  it("stops at the top tier", () => {
    expect(incentiveFor(500)).toBe(3000);
  });
});

describe("returnRate", () => {
  it("is returned out of confirmed", () => {
    expect(returnRate({ ...ZERO, confirmed: 80, returned: 6 })).toBe("8%");
  });

  it("is a dash with nothing confirmed", () => {
    expect(returnRate(ZERO)).toBe("—");
  });
});
