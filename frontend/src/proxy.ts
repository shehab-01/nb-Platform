import { NextResponse, type NextRequest } from "next/server";

import { classifyHost, normaliseHost, validSlug } from "@/lib/host";

/**
 * Host-based routing. Runs on every request (see `config.matcher`) and does
 * exactly two things, both without I/O:
 *
 * 1. Decides whether this hostname is the admin (ADMIN_HOST) or a storefront.
 *    The admin host serves the /admin route tree at the root; a store host
 *    404s /admin so staff screens never leak onto a shop's domain.
 * 2. Stamps the hostname the browser asked for onto the request as
 *    X-Store-Host, which travels with every server-component fetch and every
 *    /api rewrite. The API resolves that hostname to a store from its own
 *    cache — the proxy never looks stores up, so it never waits on the DB.
 *
 * Development fallback (DEV_STORE_FALLBACK=1): ?__store=<slug> on any store
 * host picks a store by slug, remembered in a cookie so /api/track and the
 * order POST resolve to the same store as the page. Off in production.
 */

export const STORE_HOST_HEADER = "x-store-host";
export const STORE_SLUG_HEADER = "x-store-slug";
const STORE_COOKIE = "__store";

const ADMIN_HOST = process.env.ADMIN_HOST ?? "admin.nb.local";
const DEV_STORE_FALLBACK = process.env.DEV_STORE_FALLBACK === "1";

export default function proxy(request: NextRequest) {
  const host = normaliseHost(request.headers.get("host"));
  const role = classifyHost(host, ADMIN_HOST);
  const { pathname } = request.nextUrl;

  // Request headers the app (and the API, via the /api rewrite) will see.
  // Both are overwritten, never merged: a client cannot plant a store.
  const headers = new Headers(request.headers);
  headers.set(STORE_HOST_HEADER, host ?? "");
  headers.delete(STORE_SLUG_HEADER);

  if (role === "admin") {
    // The admin is the whole site here: "/" is the dashboard, "/orders" is
    // /admin/orders. Paths already under /admin, and the API and media
    // proxies, pass through unchanged.
    if (
      pathname.startsWith("/admin") ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/media/") ||
      // The template preview the store form embeds; renders storefront
      // templates, so it lives outside the /admin tree and its CSS.
      pathname === "/preview" ||
      // Files from /public (logo, template previews): "/x/y.png" is a file,
      // not a page, on either host.
      /\.[a-z0-9]+$/i.test(pathname)
    ) {
      return NextResponse.next({ request: { headers } });
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? "/admin" : `/admin${pathname}`;
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // A storefront hostname.
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/preview") {
    return new NextResponse("Not found", { status: 404 });
  }

  let slugCookie: string | null | undefined;
  if (DEV_STORE_FALLBACK) {
    const fromQuery = validSlug(request.nextUrl.searchParams.get("__store"));
    const fromCookie = validSlug(request.cookies.get(STORE_COOKIE)?.value);
    const slug = fromQuery ?? fromCookie;
    if (slug) headers.set(STORE_SLUG_HEADER, slug);
    if (fromQuery && fromQuery !== fromCookie) slugCookie = fromQuery;
  }

  const response = NextResponse.next({ request: { headers } });
  if (slugCookie) {
    response.cookies.set(STORE_COOKIE, slugCookie, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });
  }
  return response;
}

export const config = {
  // Everything but Next's own static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
