import { describe, expect, it } from "vitest";

import { isValidAddress } from "./address";

describe("isValidAddress", () => {
  it.each([
    "House 12, Road 5, Mirpur, Dhaka",
    "মিরপুর ১০, ঢাকা",
    "12 Road-5 Dhaka",
    "  Sector 10   Uttara  ",
    "বাসা ১২ গ্রাম নয়াপাড়া",
  ])("accepts %s", (a) => expect(isValidAddress(a)).toBe(true));

  it.each(["", "Dhaka", "Dhaka Dhaka", "12 34 56", "১২ ৩৪ ৫৬", "- , . Dhaka", "Dhaka, - -"])(
    "rejects %s",
    (a) => expect(isValidAddress(a)).toBe(false),
  );
});
