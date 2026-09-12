"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { TemplatePreview } from "@/components/admin/stores/template-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  resetStoreImage,
  uploadStoreImage,
  type Store,
  type StoreInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { resolveContent, templateInfo } from "@/templates/catalog";

/** "Nature Bazar" -> "NB", "Store One" -> "SO", "Honey" -> "HONEY". */
export function suggestPrefix(name: string): string {
  const words = name
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const raw = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  const prefix = raw.replace(/^[0-9]+/, "").slice(0, 8);
  return prefix;
}

export const PREFIX_RE = /^[A-Z][A-Z0-9]{0,7}$/;

/** "Store One!" -> "store-one". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Stable identity, so a store with no uploads yet does not rebuild the
 *  preview's picture map (and re-post it to the frame) on every keystroke. */
const NO_PICTURES: Record<string, string> = {};

type Draft = {
  name: string;
  slug: string;
  slugTouched: boolean;
  orderPrefix: string;
  prefixTouched: boolean;
  domain: string;
  template: string;
  isActive: boolean;
};

/**
 * Creating a store is three things: a domain, a name and a template, with the
 * template's pictures beside them and the template itself rendered live on the
 * right — every pick shows up there before anything is saved. The slug is
 * derived from the name until it is edited by hand. Everything else about the
 * store — integrations, content, staff — lives in that store's own Settings,
 * once it exists.
 */
export function StoreForm({
  store,
  templates,
  allStores = [],
  existingPictures = NO_PICTURES,
  onSave,
}: {
  store: Store | null;
  templates: string[];
  /** Every store, for the live "prefix already used" check. */
  allStores?: Store[];
  /** The store's own pictures already uploaded, by slot key (URLs). */
  existingPictures?: Record<string, string>;
  onSave: (input: StoreInput) => Promise<Store>;
}) {
  const router = useRouter();
  const [d, setD] = React.useState<Draft>({
    name: store?.name ?? "",
    slug: store?.slug ?? "",
    slugTouched: store !== null,
    orderPrefix: store?.orderPrefix ?? "",
    prefixTouched: store !== null,
    domain: store?.primaryDomain ?? store?.domains[0] ?? "",
    template: store?.template ?? "classic",
    isActive: store?.isActive ?? true,
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Pictures chosen for the template's slots while creating. Kept as files
  // until the store exists (uploads need its id); shown at once in the
  // preview through object URLs.
  const [pictures, setPictures] = React.useState<Record<string, File>>({});
  // Slots whose uploaded picture goes back to the default on Save.
  const [resets, setResets] = React.useState<Set<string>>(new Set());
  const previewUrls = React.useMemo(
    () => Object.fromEntries(Object.entries(pictures).map(([k, f]) => [k, URL.createObjectURL(f)])),
    [pictures],
  );
  React.useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrls)) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);
  // Picture per slot for the preview panel: a pending pick, else the store's
  // own upload (unless reset back to default), else the template default.
  const previewContent = React.useMemo(() => {
    const overrides: Record<string, string> = {};
    for (const [key, url] of Object.entries(existingPictures)) {
      if (!resets.has(key)) overrides[key] = url;
    }
    Object.assign(overrides, previewUrls);
    return resolveContent(d.template, overrides);
  }, [d.template, existingPictures, resets, previewUrls]);

  const creating = store === null;
  const slots = templateInfo(d.template).content;
  const slugOk = /^[a-z0-9][a-z0-9-]{0,39}$/.test(d.slug);
  const prefixOk = PREFIX_RE.test(d.orderPrefix);
  const prefixTakenBy = allStores.find(
    (s) => s.id !== store?.id && s.orderPrefix === d.orderPrefix,
  );
  const valid =
    d.name.trim().length > 0 &&
    d.domain.trim().length > 0 &&
    prefixOk &&
    !prefixTakenBy &&
    (!creating || slugOk);
  // What is still missing, in the order the fields are asked for.
  const blocker = !d.domain.trim()
    ? "Domain is required"
    : !d.name.trim()
      ? "Store name is required"
      : creating && !slugOk
        ? "Slug must be lowercase letters, digits and dashes"
        : prefixTakenBy
          ? `Order prefix is already used by ${prefixTakenBy.name}`
          : !prefixOk
            ? "Order prefix must start with a letter"
            : null;
  const customCount = slots.filter(
    (s) => pictures[s.key] || (existingPictures[s.key] && !resets.has(s.key)),
  ).length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await onSave({
        ...(creating ? { slug: d.slug } : {}),
        name: d.name.trim(),
        template: d.template,
        currency: store?.currency ?? "BDT",
        orderPrefix: d.orderPrefix,
        theme: store?.theme ?? {},
        domains: [d.domain.trim()],
        isActive: d.isActive,
      });
      // Only slots the saved template has: a picture picked for another
      // template before switching is simply dropped.
      const keys = new Set(templateInfo(saved.template).content.map((c) => c.key));
      for (const key of resets) {
        if (keys.has(key) && !pictures[key]) await resetStoreImage(saved.id, key);
      }
      for (const [key, file] of Object.entries(pictures)) {
        if (keys.has(key)) await uploadStoreImage(saved.id, key, file);
      }
      router.push("/admin/stores");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {creating ? "Create a store" : d.name || "Edit store"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {creating
              ? "A domain, a name and a template. Products, integrations and staff come after."
              : "Domain, name and template. Integrations and content live under this store's Settings."}
          </p>
        </div>

        <Card title="Basics">
          <Row label="Domain" htmlFor="domain" hint="Your storefront address">
            <Input
              id="domain"
              autoFocus
              className="w-90 max-w-full"
              placeholder="shop.example.com"
              value={d.domain}
              onChange={(e) => setD({ ...d, domain: e.target.value })}
            />
          </Row>
          <Row label="Store name" htmlFor="name">
            <Input
              id="name"
              className="w-90 max-w-full"
              maxLength={120}
              placeholder="Nature Bazar"
              value={d.name}
              onChange={(e) =>
                setD({
                  ...d,
                  name: e.target.value,
                  slug: d.slugTouched ? d.slug : slugify(e.target.value),
                  orderPrefix: d.prefixTouched ? d.orderPrefix : suggestPrefix(e.target.value),
                })
              }
            />
          </Row>
          <Row
            label="Slug"
            htmlFor="slug"
            hint={creating ? undefined : "Fixed once the store exists"}
          >
            <Input
              id="slug"
              className="w-90 max-w-full font-mono"
              maxLength={40}
              disabled={!creating}
              placeholder="nature-bazar"
              value={d.slug}
              onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase(), slugTouched: true })}
            />
          </Row>
          <Row
            label="Order prefix"
            htmlFor="prefix"
            hint={
              prefixTakenBy ? (
                <span className="text-destructive">Already used by {prefixTakenBy.name}</span>
              ) : prefixOk ? (
                <>
                  Orders will look like{" "}
                  <span className="font-medium text-foreground">{d.orderPrefix}-10001</span>
                </>
              ) : (
                "Letters and digits, starting with a letter"
              )
            }
          >
            <Input
              id="prefix"
              className="w-24 font-mono tracking-widest uppercase"
              maxLength={8}
              placeholder="NB"
              value={d.orderPrefix}
              onChange={(e) =>
                setD({
                  ...d,
                  orderPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  prefixTouched: true,
                })
              }
            />
          </Row>
          <Row label="Template" hint="Changes the pictures and the preview">
            <Select value={d.template} onValueChange={(v) => setD({ ...d, template: v })}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t} value={t}>
                    {templateInfo(t).name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {!creating && (
            <Row label="Active" hint={d.isActive ? "Serving customers" : "Domain answers, nothing sells"}>
              <Switch checked={d.isActive} onCheckedChange={(v) => setD({ ...d, isActive: v })} />
            </Row>
          )}
        </Card>

        {slots.length > 0 && (
          <Card
            title="Pictures"
            aside={`${customCount} of ${slots.length} replaced`}
            padded={false}
          >
            {slots.map((slot) => {
              const file = pictures[slot.key];
              const uploaded = !resets.has(slot.key) ? existingPictures[slot.key] : undefined;
              const custom = Boolean(file || uploaded);
              const src = previewUrls[slot.key] ?? uploaded ?? slot.defaultUrl;
              return (
                <div
                  key={slot.key}
                  className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b px-5 py-3.5 last:border-b-0"
                >
                  <div className="basis-36">
                    <p className="text-sm font-semibold">{slot.label}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {slot.size}
                    </p>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className={cn(
                      "h-14 w-26 shrink-0 rounded-lg border object-contain p-1",
                      custom ? "border-solid bg-background" : "border-dashed bg-muted/40",
                    )}
                  />
                  <p className="min-w-0 flex-1 basis-44 text-xs text-pretty text-muted-foreground">
                    {custom ? "This store's own picture." : slot.hint}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <label className="inline-flex">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="sr-only"
                        onChange={(e) => {
                          const picked = e.target.files?.[0];
                          e.target.value = "";
                          if (picked) setPictures({ ...pictures, [slot.key]: picked });
                        }}
                      />
                      <Button type="button" variant="outline" size="sm" asChild>
                        <span className="cursor-pointer">{custom ? "Replace" : "Upload"}</span>
                      </Button>
                    </label>
                    {custom && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = { ...pictures };
                          delete next[slot.key];
                          setPictures(next);
                          if (existingPictures[slot.key]) setResets(new Set(resets).add(slot.key));
                        }}
                      >
                        Default
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !valid}>
            {busy ? "Saving…" : creating ? "Create store" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => router.push("/admin/stores")}
          >
            Cancel
          </Button>
          {blocker && (
            <span className="ml-auto text-xs text-muted-foreground">{blocker}</span>
          )}
        </div>
      </form>

      <TemplatePreview
        template={d.template}
        storeSlug={store?.slug}
        content={previewContent}
        className="xl:h-[calc(100vh-7rem)]"
      />
    </div>
  );
}

/** A titled panel: the form reads as a few short sections, not one long list. */
function Card({
  title,
  aside,
  padded = true,
  children,
}: {
  title: string;
  aside?: string;
  padded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </header>
      <div className={padded ? "px-5" : undefined}>{children}</div>
    </section>
  );
}

/** One labelled field, with its explanation beside the control. */
function Row({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b py-4 last:border-b-0">
      <Label htmlFor={htmlFor} className="basis-32 text-sm font-semibold">
        {label}
      </Label>
      <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">{children}</div>
        {hint && <span className="min-w-0 text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
