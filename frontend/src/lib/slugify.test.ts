import { describe, expect, it } from "vitest";

import { slugify, suggestPrefix } from "@/components/admin/stores/store-form";

describe("slugify", () => {
  it("makes a store slug from a name", () => {
    expect(slugify("Store One!")).toBe("store-one");
    expect(slugify("  Nature  Bazar ")).toBe("nature-bazar");
    expect(slugify("Café Déjà")).toBe("cafe-de-ja");
  });
  it("caps at 40 characters", () => {
    expect(slugify("a".repeat(60))).toHaveLength(40);
  });
});

describe("suggestPrefix", () => {
  it("takes initials of several words, else the first word", () => {
    expect(suggestPrefix("Nature Bazar")).toBe("NB");
    expect(suggestPrefix("Store One")).toBe("SO");
    expect(suggestPrefix("Honey")).toBe("HONEY");
  });
  it("never starts with a digit and stays within 8 characters", () => {
    expect(suggestPrefix("7 Eleven")).toBe("E");
    expect(suggestPrefix("Supercalifragilistic")).toBe("SUPERCAL");
  });
});
