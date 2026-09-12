import { Barlow_Condensed, Hind_Siliguri, Manrope, Noto_Sans_Bengali } from "next/font/google";

/**
 * Manrope, self-hosted by next/font: the files are fetched at build time and
 * served from our own origin, so there is no request to Google at runtime and
 * no flash of unstyled text.
 *
 * Loaded as a variable font (200–800), which covers every weight the
 * storefront and the admin ask for in one file.
 */
export const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

/**
 * Bengali carries most of the storefront, and Manrope has no Bengali glyphs.
 *
 * Noto Sans Bengali is variable across 100–900, so the 800 and 900 weights the
 * storefront leans on are real cuts rather than the browser faking a bold.
 *
 * Not preloaded: admin pages are all Latin, so the browser never matches this
 * face there and never downloads it. The storefront fetches it on first paint.
 */
export const bengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  display: "swap",
  variable: "--font-bengali",
  preload: false,
});

/**
 * Barlow Condensed is the Bazar Campaign Gold template's accent face: the
 * small uppercase campaign label and the big total. Latin only, three
 * weights, and not preloaded — only that template asks for it.
 */
export const barlow = Barlow_Condensed({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-barlow",
  preload: false,
});

/**
 * Hind Siliguri carries the landing page, Latin and Bengali alike: one face
 * for the whole page rather than Manrope for the digits and Noto for the
 * words. Static cuts only, 300–700, so the landing CSS never asks for more
 * than 700 (the browser would fake anything heavier).
 *
 * Not preloaded, for the same reason as Noto: only the landing page uses it.
 */
export const hindSiliguri = Hind_Siliguri({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["bengali", "latin"],
  display: "swap",
  variable: "--font-hind",
  preload: false,
});
