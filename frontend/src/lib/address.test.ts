import { describe, expect, it } from "vitest";

import { isValidAddress } from "./address";

describe("isValidAddress", () => {
  it.each([
    "House 12, Road 5, Mirpur, Dhaka",
    "মিরপুর ১০, ঢাকা",
    "12 Road-5 Dhaka",
    "  Sector 10   Uttara  ",
    "বাসা ১২ গ্রাম নয়াপাড়া",
    "khairtul,03,tongi",
    "বাসা ১২,মিরপুর,ঢাকা",
    "House 12/A;Uttara",
    "মিরপুর।ঢাকা।বাংলাদেশ",
    "Mirpur Dhaka",
    "Mirpur,Dhaka",
    "মিরপুর ঢাকা",
    "Dhaka",
    "ঢাকা",
    ",,,Tongi,,,",
    "- , . Dhaka",
    "Dhaka, - -",
  ])("accepts %s", (a) => expect(isValidAddress(a)).toBe(true));

  it.each(["", "   ", "- , .", "12", "12 34", "12 34 56", "১২ ৩৪ ৫৬", "12,34,56"])(
    "rejects %s",
    (a) => expect(isValidAddress(a)).toBe(false),
  );
});
