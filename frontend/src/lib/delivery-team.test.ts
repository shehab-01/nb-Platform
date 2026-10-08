import { describe, expect, it } from "vitest";

import { teamIncentive, teamReturnPct } from "./delivery-team";

// Delivered and returned for a given parcel count and exact return rate.
const at = (finished: number, pct: number) => {
  const returned = Math.round((finished * pct) / 100);
  return [finished - returned, returned] as const;
};

describe("teamReturnPct", () => {
  it("is returned out of delivered + returned", () => {
    expect(teamReturnPct(80, 20)).toBe(20);
  });

  it("rounds up, but leaves an exact percent alone", () => {
    expect(teamReturnPct(849, 151)).toBe(16); // 15.1%
    expect(teamReturnPct(85, 15)).toBe(15);
  });

  it("is null with nothing finished", () => {
    expect(teamReturnPct(0, 0)).toBeNull();
  });
});

describe("teamIncentive", () => {
  it("pays nothing under 5,000 delivered", () => {
    expect(teamIncentive(4999, 0)).toBe(0);
  });

  it("reads the row from the delivered count", () => {
    expect(teamIncentive(5000, 0)).toBe(50000);
    expect(teamIncentive(9999, 0)).toBe(50000);
    expect(teamIncentive(10000, 0)).toBe(75000);
    expect(teamIncentive(17500, 0)).toBe(150000);
    expect(teamIncentive(20000, 0)).toBe(300000);
  });

  it("reads the column from the rounded-up return rate", () => {
    expect(teamIncentive(...at(25000, 15))).toBe(300000);
    expect(teamIncentive(...at(25000, 16))).toBe(150000);
    expect(teamIncentive(...at(25000, 18))).toBe(150000);
    expect(teamIncentive(...at(25000, 19))).toBe(50000);
    expect(teamIncentive(...at(25000, 20))).toBe(50000);
  });

  it("pays nothing over 20% return", () => {
    expect(teamIncentive(...at(25000, 21))).toBe(0);
  });

  it("has the corrected 5,000+ row", () => {
    expect(teamIncentive(...at(7000, 18))).toBe(12500);
    expect(teamIncentive(...at(6250, 20))).toBe(5500);
  });
});
