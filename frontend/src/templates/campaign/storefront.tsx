"use client";

import Image from "next/image";

import "@/templates/classic/landing.css";
import "./campaign.css";
import { Storefront as Classic } from "@/templates/classic/storefront";
import { rawImage } from "@/templates/raw-image";
import type { StorefrontProps } from "@/templates/types";

/**
 * Bazar Campaign: the classic page with a poster on top. Every picture comes
 * from `store.content` (the store's upload or the template default).
 */
export function Storefront(props: StorefrontProps) {
  const c = props.store.content;
  const scrollToOrder = () => {
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Classic
      {...props}
      hidePicker
      hideTopCta
      beforeProduct={
        <div className="nb-campaign">
          <section className="nb-campaign-hero">
            <Pic src={c.banner} alt="Campaign" width={1146} height={672} priority />
          </section>
          <section className="nb-campaign-strip">
            <Pic src={c.how_it_works} alt="কীভাবে অংশগ্রহণ করবেন" width={812} height={232} />
          </section>
          <section className="nb-campaign-cta">
            <button type="button" onClick={scrollToOrder}>
              অর্ডার করুন
            </button>
          </section>
          <section className="nb-campaign-strip">
            <Pic src={c.prizes} alt="পুরস্কার" width={877} height={877} />
          </section>
          <section className="nb-campaign-showcase">
            <Pic src={c.products} alt="পণ্য" width={1120} height={450} />
          </section>
          <section className="nb-campaign-offer">
            <Pic src={c.offer_price} alt="অফার প্রাইস" width={180} height={120} />
          </section>
        </div>
      }
    />
  );
}

function Pic({
  src,
  alt,
  width,
  height,
  priority,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
}) {
  // Uploaded pictures are served by the API through /media; Next's optimiser
  // is skipped for them so their exact pixels show.
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      sizes="(max-width: 560px) 100vw, 560px"
      unoptimized={rawImage(src)}
    />
  );
}
