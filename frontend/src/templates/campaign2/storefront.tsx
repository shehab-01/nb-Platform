"use client";

import { useEffect } from "react";

import "@/templates/classic/landing.css";
import "./campaign2.css";
import { ProductPicture } from "@/components/storefront/product-picture";
import { Storefront as Classic } from "@/templates/classic/storefront";
import type { StorefrontProps } from "@/templates/types";

/** The classic page's colour variables, retuned for a dark ground. */
const GOLD_THEME: Record<string, string> = {
  "--nb-bg": "#0a3b22",
  "--deep": "#05200f",
  "--nb-gold": "#d9a537",
  "--nb-green": "#1e7a46",
  "--nb-price": "#14301f",
};

/**
 * Bazar Campaign Gold. The classic page under a dark green skin: banner,
 * campaign pitch and a pulsing gold button first, then the how-to strip,
 * prizes, product showcase and offer, each fading up as it scrolls into
 * view, and finally the classic order card restyled as a cream receipt.
 * Every picture comes from `store.content` (the store's own or the default).
 */
export function Storefront(props: StorefrontProps) {
  const c = props.store.content;
  const s = props.store.contentSrcset;
  // The dark ground and gold are this template's look, not something a
  // store's saved palette (made for the light classic page) should be able
  // to undo: the template's values win, anything else passes through.
  const store = { ...props.store, themeVars: { ...props.store.themeVars, ...GOLD_THEME } };

  // Sections fade up the first time they scroll into view. Visitors who ask
  // for less motion get everything shown at once.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-c2-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      for (const el of els) el.dataset.c2Reveal = "in";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.c2Reveal = "in";
          io.unobserve(e.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  const scrollToOrder = () => {
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="nb-c2">
      <Classic
        {...props}
        store={store}
        hidePicker
        hideTopCta
        // The banners have shown the product; the card opens on the order
        // table, and the banner (not the product photo) is the LCP.
        hideProductCard
        orderTable
        productBelowFold
        beforeProduct={
          <div className="c2">
            <section className="c2-hero">
              <ProductPicture src={c.banner} srcSet={s.banner} alt="Campaign" width={1146} height={672} priority />
            </section>

            <section className="c2-intro">
              <span className="c2-kicker">Nature Millionaire Campaign</span>
              <h1>
                প্রতিদিন জিতে নিন
                <br />
                আকর্ষণীয় পুরস্কার
              </h1>
              <p>
                স্পেশাল আচার কম্বো অর্ডার করে অংশ নিন ১০ লাখ টাকা ক্যাশ ও ১০০০+ গিফট
                আইটেমের ক্যাম্পেইনে।
              </p>
              <button type="button" className="c2-cta" onClick={scrollToOrder}>
                অর্ডার করুন
              </button>
            </section>

            <section className="c2-section" data-c2-reveal="">
              <h2>কিভাবে অংশগ্রহণ করবেন?</h2>
              <div className="c2-frame c2-frame-light">
                <ProductPicture src={c.how_it_works} srcSet={s.how_it_works} alt="কীভাবে অংশগ্রহণ করবেন" width={812} height={232} />
              </div>
            </section>

            <section className="c2-section" data-c2-reveal="">
              <h2>পুরস্কার সমূহ</h2>
              <div className="c2-frame c2-frame-light">
                <ProductPicture src={c.prizes} srcSet={s.prizes} alt="পুরস্কার" width={877} height={877} />
              </div>
            </section>

            <section className="c2-section" data-c2-reveal="">
              <h2>আমাদের স্পেশাল আচার কম্বো</h2>
              <div className="c2-frame">
                <ProductPicture src={c.products} srcSet={s.products} alt="পণ্য" width={1120} height={450} />
              </div>
            </section>

            <section className="c2-section c2-offer" data-c2-reveal="">
              <div className="c2-frame">
                <ProductPicture src={c.offer_price} srcSet={s.offer_price} alt="অফার প্রাইস" width={180} height={120} />
              </div>
            </section>
          </div>
        }
      />
    </div>
  );
}
