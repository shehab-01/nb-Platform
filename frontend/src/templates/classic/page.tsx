"use client";

import { useEffect, useState } from "react";

import "./header.css";
import { Storefront as Base } from "@/templates/classic/storefront";
import type { StorefrontProps } from "@/templates/types";

/**
 * Bazar Classic as a store sees it: the shared classic page plus a
 * see-through header whose logo slides left on scroll while a red order
 * button slides in (see .nb-cl[data-scrolled] in header.css). Kept out of
 * storefront.tsx, which the campaign templates also build on, so only this
 * template gets it.
 */
export function Storefront(props: StorefrontProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToOrder = () => {
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="nb-cl" data-scrolled={scrolled || undefined}>
      <Base
        {...props}
        headerExtra={
          <button type="button" className="cl-header-cta" onClick={scrollToOrder} tabIndex={scrolled ? 0 : -1}>
            অর্ডার করুন
          </button>
        }
      />
    </div>
  );
}
