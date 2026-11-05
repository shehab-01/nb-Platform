"use client";

import type { CSSProperties } from "react";

import "@/templates/classic/landing.css";
import "@/templates/campaign2/campaign2.css";
import { ProductPicture } from "@/components/storefront/product-picture";
import { CUSTOM_SECTIONS, EXTRA_BANNER_KEYS } from "@/templates/catalog";
import { GOLD_THEME, HeroSlider, scrollToOrder, useGoldMotion } from "@/templates/campaign2/storefront";
import { Storefront as Classic } from "@/templates/classic/storefront";
import { isLight } from "@/templates/color";
import type { StorefrontProps } from "@/templates/types";

/** Each section picture's natural size, and whether it sits on a white frame
 * (the how-to strip and prize board were drawn on white) as in Gold. */
const SECTION_PICTURES: Record<string, { width: number; height: number; light: boolean }> = {
  how_it_works: { width: 812, height: 232, light: true },
  prizes: { width: 877, height: 877, light: true },
  products: { width: 1120, height: 450, light: false },
};

/**
 * Bazar Gold Custom. Bazar Campaign Gold's page, styled by Gold's own
 * stylesheet, with every colour Gold fixes fed from `store.options` through
 * the --c2-* variables it reads, the kicker and intro written per store, and
 * the sections below the intro each shown only once its picture is uploaded.
 * The mid-page order button sits before the last section that shows, as it
 * does in Gold (between the prizes and the product showcase).
 */
export function Storefront(props: StorefrontProps) {
  const c = props.store.content;
  const s = props.store.contentSrcset;
  const o = props.store.options;
  const banners = ["banner", ...EXTRA_BANNER_KEYS].filter((key) => c[key]);
  const sections = CUSTOM_SECTIONS.filter(({ key }) => c[key]);
  // The page colour is the classic page's ground; the rest of Gold's dark
  // palette stays as it is, whatever the store's saved palette says.
  const store = {
    ...props.store,
    themeVars: { ...props.store.themeVars, ...GOLD_THEME, "--nb-bg": o.body_color },
  };
  const scrolled = useGoldMotion(sections.map(({ key }) => key).join());

  // Words on a colour the store picked follow it, so a light header, page
  // or footer never ends up with pale text on it.
  const lightBody = isLight(o.body_color);
  const lightFooter = isLight(o.footer_color);
  const vars = {
    "--c2-nav": o.nav_color,
    "--c2-footer": o.footer_color,
    "--c2-footer-ink": lightFooter ? "rgba(18, 32, 22, 0.75)" : "rgba(247, 241, 227, 0.6)",
    "--c2-footer-link": lightFooter ? "#0a3b22" : "#d9a537",
    "--c2-kicker": o.kicker_color,
    "--c2-title": lightBody ? "#14301f" : "#fff",
    "--c2-text": lightBody ? "rgba(20, 48, 31, 0.75)" : "rgba(247, 241, 227, 0.72)",
  } as CSSProperties;

  return (
    <div className="nb-c2" style={vars} data-scrolled={scrolled || undefined}>
      <Classic
        {...props}
        store={store}
        hidePicker
        hideTopCta
        hideBottomCta
        headerExtra={
          <button type="button" className="c2-header-cta" onClick={scrollToOrder} tabIndex={scrolled ? 0 : -1}>
            অর্ডার করুন
          </button>
        }
        hideProductCard
        orderTable
        productBelowFold
        beforeProduct={
          <div className="c2">
            <section className="c2-hero">
              <HeroSlider slides={banners.map((key) => ({ src: c[key], srcSet: s[key] }))} />
            </section>

            <section className="c2-intro">
              <span className="c2-kicker">{o.kicker}</span>
              <h1>
                <span className="c2-line">{o.headline}</span>
                <br />
                <span className="c2-line">{o.draw_date}</span>
              </h1>
              <p>{o.intro}</p>
              <button type="button" className="c2-cta" onClick={scrollToOrder}>
                অর্ডার করুন
              </button>
            </section>

            {sections.map(({ key }, i) => {
              const pic = SECTION_PICTURES[key];
              const title = o[`${key}_title`];
              return (
                <div key={key}>
                  <section
                    className="c2-section"
                    data-c2-reveal=""
                    style={{ "--c2-heading": o[`${key}_title_color`] } as CSSProperties}
                  >
                    <h2>{title}</h2>
                    <div className={pic.light ? "c2-frame c2-frame-light" : "c2-frame"}>
                      <ProductPicture src={c[key]} srcSet={s[key]} alt={title} width={pic.width} height={pic.height} />
                    </div>
                  </section>
                  {i === sections.length - 2 && (
                    <div className="c2-cta-row" data-c2-reveal="">
                      <button type="button" className="c2-cta" onClick={scrollToOrder}>
                        অর্ডার করুন
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        }
      />
    </div>
  );
}
