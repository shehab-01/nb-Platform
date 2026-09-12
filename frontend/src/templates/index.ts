// Storefront templates, by the name a store carries in `stores.template`.
//
// Each entry is a dynamic import so a page only ever loads the one template
// the store uses: adding a template is a new folder plus one line here (and
// the same name in backend api/routers/stores.py TEMPLATES, which validates
// what the admin may save).

import type { TemplateModule } from "@/templates/types";

export const DEFAULT_TEMPLATE = "classic";

const registry: Record<string, () => Promise<TemplateModule>> = {
  classic: () => import("@/templates/classic"),
  campaign: () => import("@/templates/campaign"),
  campaign2: () => import("@/templates/campaign2"),
};

export function templateNames(): string[] {
  return Object.keys(registry);
}

/**
 * The template's name if it exists, else the default (logged, since a store
 * pointing at a missing template is a data problem worth noticing, not a
 * reason to show an error page to a customer).
 */
export function resolveTemplateName(name: string | null | undefined): string {
  if (name && name in registry) return name;
  if (name) console.warn(`[templates] unknown template "${name}", using ${DEFAULT_TEMPLATE}`);
  return DEFAULT_TEMPLATE;
}

export async function loadTemplate(name: string | null | undefined): Promise<TemplateModule> {
  return registry[resolveTemplateName(name)]();
}
