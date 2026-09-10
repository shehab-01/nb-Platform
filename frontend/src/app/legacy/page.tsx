import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Storefront } from "@/components/storefront/storefront";
import { storeHeaders } from "@/lib/store";
import { fetchActiveProduct } from "@/lib/storefront-api";

/**
 * The original landing page, kept after `/` moves to the new design so the
 * old one can still be looked at. Not for the public: with SHOW_LEGACY_LANDING
 * unset this route is a 404, so it only opens for whoever sets the flag on the
 * server — or for anyone running the app locally with it in .env.
 *
 * It is a live copy rather than a screenshot: it reads the product currently
 * on sale and its form posts real orders. Leave the flag off in production
 * unless you are deliberately looking at it.
 */

// The flag is read per request, not baked in at build time, so turning the
// page on is a container restart rather than a rebuild. Without this Next is
// free to prerender the 404 and the flag would never be consulted again.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nature Bazar",
  // Unreachable while the flag is off, and unindexable in the window where
  // someone has turned it on.
  robots: { index: false, follow: false },
};

export default async function LegacyLanding() {
  if (process.env.SHOW_LEGACY_LANDING !== "1") notFound();

  // Nothing live means nothing this page could sell either.
  const product = await fetchActiveProduct(await storeHeaders());
  if (product === null) notFound();
  return <Storefront product={product} />;
}
