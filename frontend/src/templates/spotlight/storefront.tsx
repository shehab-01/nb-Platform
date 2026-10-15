"use client";

import type { CSSProperties } from "react";

import "./spotlight.css";
import { Storefront as Classic } from "@/templates/classic/page";
import { rawImage } from "@/templates/raw-image";
import type { StorefrontProps } from "@/templates/types";

/**
 * Bazar Spotlight: Bazar Classic exactly — size picker, order table — except
 * that the product card shows one picture the store uploaded
 * (`content.spotlight`) whichever size is picked. The card's title, the
 * picker heading and the header and footer colours are `store.options`.
 */
export function Storefront(props: StorefrontProps) {
  const { content, contentSrcset, options } = props.store;
  // Only the store's own upload (or the form's pending pick, in the
  // preview) replaces the size's picture; until there is one, the card
  // behaves as Bazar Classic's does rather than show a stand-in.
  const ownPicture = rawImage(content.spotlight);
  const footer = options.footer_color;
  const vars = {
    "--sp-nav": options.nav_color,
    "--sp-footer": footer,
    // The footer's words follow its colour, so a light footer a store
    // picks never ends up with pale text on it.
    "--sp-footer-ink": isLight(footer) ? "rgba(18, 32, 22, 0.75)" : "rgba(247, 241, 227, 0.7)",
    "--sp-footer-link": isLight(footer) ? "#0a3b22" : "#d9a537",
  } as CSSProperties;
  return (
    <div className="nb-sp" style={vars}>
      <Classic
        {...props}
        pickHeading={options.pick_heading}
        // Empty unless the store wrote one: then the picked size's title.
        productTitle={options.product_title}
        fixedPicture={
          ownPicture ? { src: content.spotlight, srcSet: contentSrcset.spotlight } : undefined
        }
      />
    </div>
  );
}

/** Whether "#rrggbb" is light enough to want dark text (WCAG luminance). */
function isLight(hex: string): boolean {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4;
}
