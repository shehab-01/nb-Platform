import { describe, expect, it } from "vitest";

import { incentiveFor, payableShare, returnRate, ZERO } from "./staff-stats";

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

  it("rounds up to a whole percent", () => {
    expect(returnRate({ ...ZERO, confirmed: 1000, returned: 181 })).toBe("19%");
    expect(returnRate({ ...ZERO, confirmed: 1000, returned: 171 })).toBe("18%");
  });

  it("leaves an exact whole percent alone", () => {
    // 9 of 50 is 18% exactly; it must not become 19%.
    expect(returnRate({ ...ZERO, confirmed: 50, returned: 9 })).toBe("18%");
  });

  it("is a dash with nothing confirmed", () => {
    expect(returnRate(ZERO)).toBe("—");
  });
});

describe("payableShare", () => {
  const month = (returned: number) => ({ ...ZERO, confirmed: 1000, returned });

  it("pays in full up to 18%, after rounding up", () => {
    expect(payableShare(month(0))).toBe(1);
    expect(payableShare(month(171))).toBe(1); // 17.1% → 18%
    expect(payableShare(month(180))).toBe(1); // 18%
    expect(payableShare({ ...ZERO, confirmed: 50, returned: 9 })).toBe(1);
  });

  it("pays half at 19%", () => {
    expect(payableShare(month(181))).toBe(0.5); // 18.1% → 19%
    expect(payableShare(month(190))).toBe(0.5); // 19%
  });

  it("pays a quarter from 20% to 24%", () => {
    expect(payableShare(month(191))).toBe(0.25); // 19.1% → 20%
    expect(payableShare(month(240))).toBe(0.25); // 24%
  });

  it("pays nothing from 25%", () => {
    expect(payableShare(month(241))).toBe(0); // 24.1% → 25%
    expect(payableShare(month(600))).toBe(0);
  });

  it("pays in full with nothing confirmed", () => {
    expect(payableShare(ZERO)).toBe(1);
  });
});
