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
 * Creating a store is three things: a domain, a name and a template. The
 * slug is derived from the name until it is edited by hand. Everything else
 * about the store — integrations, content, staff — lives in that store's own
 * Settings, once it exists.
 */
export function StoreForm({
  store,
  templates,
  allStores = [],
  existingPictures = {},
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
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
        <Field label="Domain" htmlFor="domain">
          <Input
            id="domain"
            autoFocus
            placeholder="shop.example.com"
            value={d.domain}
            onChange={(e) => setD({ ...d, domain: e.target.value })}
          />
        </Field>
        <Field label="Store name" htmlFor="name">
          <Input
            id="name"
            maxLength={120}
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
        </Field>
        <Field label="Slug" htmlFor="slug">
          <Input
            id="slug"
            maxLength={40}
            disabled={!creating}
            value={d.slug}
            onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase(), slugTouched: true })}
          />
        </Field>
        <Field label="Order prefix" htmlFor="prefix">
          <div className="flex items-center gap-3">
            <Input
              id="prefix"
              className="w-32 uppercase"
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
            <span className="text-sm text-muted-foreground">
              {prefixTakenBy ? (
                <span className="text-destructive">Already used by {prefixTakenBy.name}</span>
              ) : prefixOk ? (
                <>
                  Orders will look like{" "}
                  <span className="font-medium text-foreground">{d.orderPrefix}-10001</span>
                </>
              ) : (
                "Letters and digits, starting with a letter"
              )}
            </span>
          </div>
        </Field>
        <Field label="Template">
          <Select value={d.template} onValueChange={(v) => setD({ ...d, template: v })}>
            <SelectTrigger>
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
        </Field>
        {slots.length > 0 && (
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Pictures
            </p>
            {slots.map((slot) => {
              const file = pictures[slot.key];
              const uploaded = !resets.has(slot.key) ? existingPictures[slot.key] : undefined;
              const custom = Boolean(file || uploaded);
              return (
                <Field key={slot.key} label={slot.label}>
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrls[slot.key] ?? uploaded ?? slot.defaultUrl}
                      alt={slot.label}
                      className="h-12 w-20 shrink-0 rounded bg-muted object-contain"
                    />
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
                        <span>{custom ? "Replace" : "Upload"}</span>
                      </Button>
                    </label>
                    {custom ? (
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
                        Use default
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{slot.size}</span>
                    )}
                  </div>
                </Field>
              );
            })}
          </div>
        )}
        {!creating && (
          <Field label="Active">
            <div className="flex h-9 items-center">
              <Switch checked={d.isActive} onCheckedChange={(v) => setD({ ...d, isActive: v })} />
            </div>
          </Field>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={busy || !valid}>
            {creating ? "Create store" : "Save"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => router.push("/admin/stores")}>
            Cancel
          </Button>
        </div>
        {!creating && (
          <p className="text-xs text-muted-foreground">
            Pixel, Pathao and other integrations are under Settings once this
            store is selected in the switcher.
          </p>
        )}
      </form>
      <TemplatePreview template={d.template} content={previewContent} />
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-1.5 sm:grid-cols-[140px_1fr] sm:gap-4">
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
      </Label>
      <div>{children}</div>
    </div>
  );
}
