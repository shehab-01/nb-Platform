import { describe, expect, it, vi } from "vitest";

import { DEFAULT_TEMPLATE, loadTemplate, resolveTemplateName, templateNames } from "@/templates";
import { TEMPLATE_CATALOG, resolveContent, resolveOptions, templateInfo } from "@/templates/catalog";

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
  it("says which templates sell only the default variant", () => {
    expect(TEMPLATE_CATALOG.classic.singleVariant).toBe(false);
    expect(TEMPLATE_CATALOG.campaign.singleVariant).toBe(true);
    expect(TEMPLATE_CATALOG.campaign2.singleVariant).toBe(true);
    expect(templateInfo("no-such").singleVariant).toBe(false);
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
  it("resolves text and colours with defaults and only hex colours", () => {
    const o = resolveOptions("spotlight", {
      pick_heading: "  কয়টি নিতে চান?  ",
      nav_color: "#ABCDEF",
      footer_color: "red; background:url(x)",
      header: "#000000",
    });
    expect(o.pick_heading).toBe("কয়টি নিতে চান?");
    expect(o.nav_color).toBe("#abcdef");
    expect(o.footer_color).toBe(TEMPLATE_CATALOG.spotlight.colors[1].defaultValue);
    expect("header" in o).toBe(false);
    expect(resolveOptions("spotlight", {}).pick_heading).toBe("কত প্যাকেট নিতে চান সিলেক্ট করুন");
    // No title written: empty, so the page shows the picked size's own.
    expect(resolveOptions("spotlight", {}).product_title).toBe("");
    expect(resolveOptions("spotlight", { product_title: "মধু" }).product_title).toBe("মধু");
    expect(resolveOptions("classic", { nav_color: "#000000" })).toEqual({});
  });
  it("spotlight keeps the size picker and has its own product picture", () => {
    expect(TEMPLATE_CATALOG.spotlight.singleVariant).toBe(false);
    expect(Object.keys(resolveContent("spotlight", {}))).toEqual(["logo", "spotlight"]);
  });
  it("loads a module with the two components", async () => {
    const tpl = await loadTemplate("classic");
    expect(typeof tpl.Storefront).toBe("function");
    expect(typeof tpl.Closed).toBe("function");
  });
});
