import { describe, expect, it } from "vitest";

import { COOLDOWN_CHOICES, cooldownMessageBn } from "./cooldown";

describe("cooldownMessageBn", () => {
  it("says nothing about trying again when the block is for good", () => {
    expect(cooldownMessageBn(0)).not.toContain("চেষ্টা করুন");
  });
  it("words the window in Bangla days or hours", () => {
    expect(cooldownMessageBn(168)).toContain("৭ দিন পর আবার চেষ্টা করুন");
    expect(cooldownMessageBn(72)).toContain("৩ দিন");
    expect(cooldownMessageBn(12)).toContain("১২ ঘণ্টা");
  });
  it("offers forever first", () => {
    expect(COOLDOWN_CHOICES[0].hours).toBe(0);
  });
});
