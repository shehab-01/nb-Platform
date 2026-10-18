import { describe, expect, it } from "vitest";

import { courierLabel, courierStatusLabel } from "./orders";

describe("courierStatusLabel", () => {
  it("reads Pathao's and Carrybee's spellings the same way", () => {
    expect(courierStatusLabel("Pickup_Requested")).toBe("Pickup Requested");
    expect(courierStatusLabel("pickup-requested")).toBe("Pickup Requested");
    expect(courierStatusLabel("returned-to-merchant")).toBe("Returned To Merchant");
  });

  it("is empty for no status", () => {
    expect(courierStatusLabel(null)).toBe("");
    expect(courierStatusLabel(undefined)).toBe("");
  });
});

describe("courierLabel", () => {
  it("names the courier, Pathao for bookings from before Carrybee", () => {
    expect(courierLabel({ courierProvider: "carrybee" })).toBe("Carrybee");
    expect(courierLabel({ courierProvider: null })).toBe("Pathao");
  });
});
