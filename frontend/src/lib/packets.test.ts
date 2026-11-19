import { describe, expect, it } from "vitest";

import { packetsInLabel } from "@/lib/packets";

describe("packetsInLabel", () => {
  it("reads the packets a Bangla size names", () => {
    expect(packetsInLabel("৩ প্যাকেট ( ৬০ পিছ)")).toBe(3);
    expect(packetsInLabel("১০ প্যাকেট (২০০ পিছ)")).toBe(10);
    expect(packetsInLabel("৫ প্যাকেট (১০০ পিছ)")).toBe(5);
  });

  it("reads English too", () => {
    expect(packetsInLabel("3 packets")).toBe(3);
    expect(packetsInLabel("Combo of 5 pack")).toBe(5);
  });

  it("says nothing for a size that is not in packets", () => {
    expect(packetsInLabel("২ কেজি")).toBeNull();
    expect(packetsInLabel("")).toBeNull();
    expect(packetsInLabel("0 packets")).toBeNull();
  });
});
