"use client";

import "@/templates/classic/landing.css";
import "./campaign.css";
import { Storefront as Classic } from "@/templates/classic/storefront";
import { ProductPicture } from "@/components/storefront/product-picture";
import type { StorefrontProps } from "@/templates/types";

/**
 * Bazar Campaign: the classic page with a poster on top. Every picture comes
 * from `store.content` (the store's upload or the template default).
 */
export function Storefront(props: StorefrontProps) {
  const c = props.store.content;
  const s = props.store.contentSrcset;
  const scrollToOrder = () => {
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Classic
      {...props}
      hidePicker
      hideTopCta
      // The banners above have shown the product; the card opens straight
      // on the order table.
      hideProductCard
      orderTable
      // The banner is what a visitor sees first: it, not the product photo
      // further down, is the picture worth fetching before everything else.
      productBelowFold
      beforeProduct={
        <div className="nb-campaign">
          <section className="nb-campaign-hero">
            <Pic src={c.banner} srcSet={s.banner} alt="Campaign" width={1146} height={672} priority />
          </section>
          <section className="nb-campaign-strip">
            <Pic src={c.how_it_works} srcSet={s.how_it_works} alt="কীভাবে অংশগ্রহণ করবেন" width={812} height={232} />
          </section>
          <section className="nb-campaign-cta">
            <button type="button" onClick={scrollToOrder}>
              অর্ডার করুন
            </button>
          </section>
          <section className="nb-campaign-strip">
            <Pic src={c.prizes} srcSet={s.prizes} alt="পুরস্কার" width={877} height={877} />
          </section>
          <section className="nb-campaign-showcase">
            <Pic src={c.products} srcSet={s.products} alt="পণ্য" width={1120} height={450} />
          </section>
          <section className="nb-campaign-offer">
            <Pic src={c.offer_price} srcSet={s.offer_price} alt="অফার প্রাইস" width={180} height={120} />
          </section>
        </div>
      }
    />
  );
}

function Pic({
  src,
  srcSet,
  alt,
  width,
  height,
  priority,
}: {
  src: string;
  /** The store's own upload has resized copies; a template default does not. */
  srcSet?: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
}) {
  return (
    <ProductPicture
      src={src}
      srcSet={srcSet}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
    />
  );
}
