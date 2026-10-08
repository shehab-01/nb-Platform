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

// A month where `finished` parcels came back from Pathao, `returned` of them
// returned, plus orders that never finished (cancelled before shipping,
// still on the road) which the rate must ignore.
const settled = (finished: number, returned: number) => ({
  ...ZERO,
  confirmed: finished + 25,
  delivered: finished - returned,
  returned,
  in_transit: 15,
});

describe("returnRate", () => {
  it("is returned out of delivered + returned", () => {
    // 100 confirmed, 80 delivered, 20 returned.
    expect(returnRate({ ...ZERO, confirmed: 100, delivered: 80, returned: 20 })).toBe("20%");
  });

  it("ignores orders that never finished", () => {
    // 100 confirmed, 10 cancelled, 72 delivered, 18 returned → 18 of 90.
    expect(returnRate({ ...ZERO, confirmed: 100, delivered: 72, returned: 18 })).toBe("20%");
  });

  it("rounds up to a whole percent", () => {
    expect(returnRate(settled(1000, 181))).toBe("19%");
    expect(returnRate(settled(1000, 171))).toBe("18%");
  });

  it("leaves an exact whole percent alone", () => {
    // 9 of 50 is 18% exactly; it must not become 19%.
    expect(returnRate(settled(50, 9))).toBe("18%");
  });

  it("is a dash with nothing finished", () => {
    expect(returnRate(ZERO)).toBe("—");
    expect(returnRate({ ...ZERO, confirmed: 40, in_transit: 40 })).toBe("—");
  });
});

describe("payableShare", () => {
  const month = (returned: number) => settled(1000, returned);

  it("pays in full up to 18%, after rounding up", () => {
    expect(payableShare(month(0))).toBe(1);
    expect(payableShare(month(171))).toBe(1); // 17.1% → 18%
    expect(payableShare(month(180))).toBe(1); // 18%
    expect(payableShare(settled(50, 9))).toBe(1);
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

  it("pays in full with nothing finished", () => {
    expect(payableShare(ZERO)).toBe(1);
  });
});
