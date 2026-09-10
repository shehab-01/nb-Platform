import { describe, expect, it, vi } from "vitest";

import { DEFAULT_TEMPLATE, loadTemplate, resolveTemplateName, templateNames } from "@/templates";
import { TEMPLATE_CATALOG, resolveContent } from "@/templates/catalog";

describe("template registry", () => {
  it("knows the classic template", () => {
    expect(templateNames()).toContain("classic");
    expect(DEFAULT_TEMPLATE).toBe("classic");
  });
  it("resolves known names and falls back for unknown ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveTemplateName("classic")).toBe("classic");
    expect(resolveTemplateName("no-such")).toBe("classic");
    expect(resolveTemplateName(null)).toBe("classic");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it("has catalog metadata for every template and nothing else", () => {
    expect(Object.keys(TEMPLATE_CATALOG).sort()).toEqual(templateNames().sort());
    for (const info of Object.values(TEMPLATE_CATALOG)) {
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.preview.startsWith("/")).toBe(true);
    }
  });
  it("resolves content with defaults and drops foreign keys", () => {
    const c = resolveContent("campaign", { banner: "/media/stores/2/x.jpg", nope: "/y" });
    expect(c.banner).toBe("/media/stores/2/x.jpg");
    expect(c.logo).toBe("/logo.png");
    expect(c.prizes).toBe("/prizes.jpg");
    expect("nope" in c).toBe(false);
    expect(Object.keys(resolveContent("classic", {}))).toEqual(["logo"]);
    expect(resolveContent("unknown", {}).logo).toBe("/logo.png");
  });
  it("loads a module with the two components", async () => {
    const tpl = await loadTemplate("classic");
    expect(typeof tpl.Storefront).toBe("function");
    expect(typeof tpl.Closed).toBe("function");
  });
});
