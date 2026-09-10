"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { gtmId, pixelId, trackPageView } from "@/lib/tracking";

const FBEVENTS_SRC = "https://connect.facebook.net/en_US/fbevents.js";
/** Load the SDKs by this point even if the visitor never touches the page. */
const LOAD_AFTER_MS = 1500;
const FIRST_INTERACTION = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/**
 * Loads the Meta Pixel SDK (and optionally GTM) on public storefront routes,
 * and fires PageView on client-side navigations.
 *
 * The fbq stub, the cookies and the initial PageView are handled by the inline
 * bootstrap in the document head (see lib/pixel-bootstrap.ts), so by the time
 * this mounts every event is already being queued. All this has to do is
 * fetch fbevents.js — after hydration, on the first interaction or a short
 * timer, whichever comes first — so the SDK never competes with the page for
 * the first paint. Admin routes are excluded so staff traffic never reaches
 * ad platforms.
 */
export default function MetaPixel() {
  const pathname = usePathname();
  // Staff screens and the admin's template preview never reach ad platforms.
  const isAdmin =
    (pathname?.startsWith("/admin") || pathname?.startsWith("/preview")) ?? false;
  const lastTracked = useRef(pathname);

  // PageView on client-side navigations; the initial load is covered by the
  // inline bootstrap.
  useEffect(() => {
    if (isAdmin || pathname === lastTracked.current) return;
    lastTracked.current = pathname;
    trackPageView();
  }, [pathname, isAdmin]);

  // Deferred SDK loading, once per page load.
  useEffect(() => {
    const pixel = pixelId();
    const gtm = gtmId();
    if (isAdmin || (!pixel && !gtm)) return;
    let done = false;
    const load = () => {
      if (done) return;
      done = true;
      cleanup();
      if (pixel) inject("meta-pixel-sdk", FBEVENTS_SRC);
      if (gtm) {
        window.dataLayer = window.dataLayer ?? [];
        window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
        inject("gtm", `https://www.googletagmanager.com/gtm.js?id=${gtm}`);
      }
    };
    const timer = setTimeout(load, LOAD_AFTER_MS);
    for (const name of FIRST_INTERACTION) {
      window.addEventListener(name, load, { once: true, passive: true });
    }
    function cleanup() {
      clearTimeout(timer);
      for (const name of FIRST_INTERACTION) window.removeEventListener(name, load);
    }
    return cleanup;
  }, [isAdmin]);

  return null;
}

/** Append an async script tag once; a second call with the same id is a no-op. */
function inject(id: string, src: string) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}
