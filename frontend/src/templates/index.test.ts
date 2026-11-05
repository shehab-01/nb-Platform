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
  it("gold's extra hero banners are empty until uploaded", () => {
    const c = resolveContent("campaign2", { banner_3: "/media/stores/2/b3.jpg" });
    expect(c.banner).toBe("/campaign.jpg");
    expect(c.banner_2).toBe("");
    expect(c.banner_3).toBe("/media/stores/2/b3.jpg");
    // The plain campaign template keeps its single banner.
    expect("banner_2" in resolveContent("campaign", {})).toBe(false);
  });
  it("gold custom drops the offer badge and keeps its sections off until uploaded", () => {
    expect(TEMPLATE_CATALOG.campaign3.singleVariant).toBe(true);
    const c = resolveContent("campaign3", { prizes: "/media/stores/2/p.jpg", offer_price: "/x.png" });
    expect(c.banner).toBe("/campaign.jpg");
    expect(c.how_it_works).toBe("");
    expect(c.prizes).toBe("/media/stores/2/p.jpg");
    expect(c.products).toBe("");
    expect("offer_price" in c).toBe(false);
  });
  it("gold custom groups each section's picture, title and title colour", () => {
    const info = TEMPLATE_CATALOG.campaign3;
    for (const key of ["how_it_works", "prizes", "products"]) {
      const group = info.content.find((f) => f.key === key)?.group;
      expect(group).toBeTruthy();
      expect(info.texts.find((f) => f.key === `${key}_title`)?.group).toBe(group);
      expect(info.colors.find((f) => f.key === `${key}_title_color`)?.group).toBe(group);
    }
    const o = resolveOptions("campaign3", { body_color: "#FFFFFF", kicker: "নতুন ক্যাম্পেইন" });
    expect(o.body_color).toBe("#ffffff");
    expect(o.nav_color).toBe("#05200f");
    expect(o.kicker).toBe("নতুন ক্যাম্পেইন");
    expect(o.prizes_title).toBe("পুরস্কার সমূহ");
  });
  it("loads a module with the two components", async () => {
    const tpl = await loadTemplate("classic");
    expect(typeof tpl.Storefront).toBe("function");
    expect(typeof tpl.Closed).toBe("function");
  });
});
