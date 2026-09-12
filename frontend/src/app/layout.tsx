import type { Metadata } from "next";
import "./globals.css";

import MetaPixel from "@/components/MetaPixel";
import { barlow, bengali, hindSiliguri, manrope } from "@/lib/fonts";
import { pixelBootstrap } from "@/lib/pixel-bootstrap";
import { getStore } from "@/lib/store";
import { STORE_SCRIPT_ID } from "@/lib/store-public";

export const metadata: Metadata = {
  title: "Nature Bazar",
  description: "A fresh starting point.",
};

// Per request: the store comes from the Host header, and with it the pixel
// id. The admin host resolves to no store, so it gets neither the pixel
// bootstrap nor the public config script.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = await getStore();
  const pixelId = store?.meta_pixel_id ?? "";
  const PIXEL_BOOTSTRAP = pixelBootstrap(pixelId);
  const publicConfig = store
    ? {
        slug: store.slug,
        currency: store.currency,
        pixelId,
        gtmId: process.env.GTM_ID ?? "",
      }
    : null;
  return (
    // The root layout wraps the admin too, so one class serves both.
    <html lang="en" className={`${manrope.variable} ${bengali.variable} ${hindSiliguri.variable} ${barlow.variable}`}>
      <head>
        {/* The store's public config for the browser (lib/store-public):
            what tracking.ts reads the pixel id from. JSON in a script tag is
            inert; </script> in a value is escaped so it cannot break out. */}
        {publicConfig ? (
          <script
            id={STORE_SCRIPT_ID}
            type="application/json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(publicConfig).replace(/</g, "\\u003c"),
            }}
          />
        ) : null}
        {/* A ternary, not `&&`: with no pixel id the bootstrap is "", and
            `"" && x` is "", which React would render as a text node inside
            <head> — invalid there, and a hydration failure that drops every
            stylesheet on the page. */}
        {PIXEL_BOOTSTRAP ? (
          <>
            <link rel="preconnect" href="https://connect.facebook.net" />
            {/* Synchronous and first: defines window.fbq so no event is ever
                dropped, sets _fbp/_fbc, and fires the initial PageView. The
                SDK itself is loaded later by <MetaPixel />. Skips /admin. */}
            <script
              id="meta-pixel-bootstrap"
              dangerouslySetInnerHTML={{ __html: PIXEL_BOOTSTRAP }}
            />
          </>
        ) : null}
      </head>
      <body>
        <MetaPixel />
        {children}
      </body>
    </html>
  );
}
