import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import "@/templates/classic/landing.css";
import { getStore, getStoreDirectory, storeHeaders, themeVars } from "@/lib/store";
import { fetchStorefrontListing } from "@/lib/storefront-api";
import { loadTemplate, resolveTemplateName } from "@/templates";
import { resolveContent } from "@/templates/catalog";
import type { StorePublicConfig } from "@/templates/types";

/**
 * The storefront root. Resolves the store from the hostname the proxy stamped
 * on the request, then renders that store's template with its offer — the
 * live product, its description and its sizes — already in the HTML.
 *
 * With no store on this hostname the page says so (and, in development,
 * lists the stores that exist). With a store but nothing live, the shop says
 * it is closed for the moment: there is deliberately no bundled product.
 *
 * Which component set renders is `store.template`, looked up in the template
 * registry (src/templates). Only that template's code is loaded.
 */

// Per request: which store depends on the Host header.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStore();
  return { title: store?.name ?? "Store not found" };
}

export default async function Home() {
  const store = await getStore();
  if (store === null) return <NoStore />;
  const [template, listing] = await Promise.all([
    loadTemplate(store.template),
    fetchStorefrontListing(await storeHeaders()),
  ]);
  const publicConfig: StorePublicConfig = {
    slug: store.slug,
    name: store.name,
    currency: store.currency,
    themeVars: themeVars(store.theme),
    content: resolveContent(resolveTemplateName(store.template), store.content),
    contentSrcset: store.content_srcset ?? {},
  };
  if (listing === null) return <template.Closed store={publicConfig} />;
  return <template.Storefront store={publicConfig} listing={listing} />;
}

/** No store answers on this hostname. In development the seeded stores are
 * listed with links; in production (empty directory) it is a real 404 with
 * the plain not-found page, so a stray hostname learns nothing. */
async function NoStore() {
  const directory = await getStoreDirectory();
  if (directory.length === 0) notFound();
  const h = await headers();
  const requested = h.get("x-store-host") || h.get("host") || "";
  const port = (h.get("host") ?? "").split(":")[1];
  const suffix = port ? `:${port}` : "";
  return (
    <main className="nb-landing">
      <div className="nb-stack">
        <section className="nb-card nb-closed">
          <h1>No store at {requested || "this address"}</h1>
          {directory.length > 0 ? (
            <>
              <p>Stores on this platform (development only):</p>
              <ul style={{ textAlign: "left", lineHeight: 1.9 }}>
                {directory.map((s) => (
                  <li key={s.slug}>
                    <strong>{s.name}</strong>
                    {s.domains.map((d) => (
                      <span key={d}>
                        {" "}
                        · <a href={`http://${d}${suffix}/`}>{d}</a>
                      </span>
                    ))}{" "}
                    · <a href={`/?__store=${s.slug}`}>?__store={s.slug}</a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Nothing here.</p>
          )}
        </section>
      </div>
    </main>
  );
}
