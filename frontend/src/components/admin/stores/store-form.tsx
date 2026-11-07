"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { TemplatePreview } from "@/components/admin/stores/template-preview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Product } from "@/lib/products";
import { cn } from "@/lib/utils";
import {
  isHexColor,
  resolveContent,
  resolveOptions,
  templateInfo,
  type ColorField,
  type ContentField,
  type TextField,
} from "@/templates/catalog";
import { COOLDOWN_CHOICES } from "@/templates/cooldown";

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
  subtitle: string;
  slug: string;
  slugTouched: boolean;
  orderPrefix: string;
  prefixTouched: boolean;
  domain: string;
  template: string;
  /** Repeat-order block in hours; 0 means for good. */
  orderCooldownHours: number;
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
  liveProduct = null,
  onSave,
}: {
  store: Store | null;
  templates: string[];
  /** Every store, for the live "prefix already used" check. */
  allStores?: Store[];
  /** The store's product on sale, so the form can say what a template
   *  without a size picker would actually sell. */
  liveProduct?: Product | null;
  /** The store's own pictures already uploaded, by slot key (URLs). */
  existingPictures?: Record<string, string>;
  onSave: (input: StoreInput) => Promise<Store>;
}) {
  const router = useRouter();
  const [d, setD] = React.useState<Draft>({
    name: store?.name ?? "",
    subtitle: store?.subtitle ?? "",
    slug: store?.slug ?? "",
    slugTouched: store !== null,
    orderPrefix: store?.orderPrefix ?? "",
    prefixTouched: store !== null,
    domain: store?.primaryDomain ?? store?.domains[0] ?? "",
    template: store?.template ?? "classic",
    orderCooldownHours: store?.orderCooldownHours ?? 0,
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

  // The template's text and colours as typed, by key; saved into the
  // store's theme. A key left empty goes back to the template default.
  const [opts, setOpts] = React.useState<Record<string, string>>(() => ({ ...(store?.theme ?? {}) }));
  const previewOptions = React.useMemo(() => resolveOptions(d.template, opts), [d.template, opts]);

  const creating = store === null;
  const slots = templateInfo(d.template).content;
  const textFields = templateInfo(d.template).texts;
  const colorFields = templateInfo(d.template).colors;
  // Grouped fields (a section's picture, title and colour) get a card per
  // group, in the order the template lists them; the rest go in the
  // Pictures and Text & colours cards.
  const pictureSlots = slots.filter((f) => !f.group);
  const ownTexts = textFields.filter((f) => !f.group);
  const ownColors = colorFields.filter((f) => !f.group);
  const groups = [
    ...new Set([...slots, ...textFields, ...colorFields].flatMap((f) => (f.group ? [f.group] : []))),
  ];
  const badColor = colorFields.find((f) => opts[f.key] && !isHexColor(opts[f.key]));
  // Switching a store that offers several sizes onto a template without a
  // picker silently narrows the offer to the default size. Orders stay
  // correct either way (the API prices from the variant the page names),
  // but the admin must know what will be on sale, so the change is spelled
  // out and has to be acknowledged before Save.
  const [narrowingConfirmed, setNarrowingConfirmed] = React.useState(false);
  const narrowing = React.useMemo(() => {
    if (!store || !liveProduct || liveProduct.variants.length < 2) return null;
    if (d.template === store.template) return null;
    if (!templateInfo(d.template).singleVariant || templateInfo(store.template).singleVariant) {
      return null;
    }
    const sold = liveProduct.variants.find((v) => v.isDefault) ?? liveProduct.variants[0];
    return { sold, hidden: liveProduct.variants.filter((v) => v !== sold) };
  }, [store, liveProduct, d.template]);
  React.useEffect(() => setNarrowingConfirmed(false), [d.template]);
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
    (!creating || slugOk) &&
    !badColor &&
    (narrowing === null || narrowingConfirmed);
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
            : badColor
              ? `${badColor.label} must look like #1a9c4d`
              : narrowing && !narrowingConfirmed
                ? "Confirm the template change"
                : null;
  const customCount = pictureSlots.filter(
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
        subtitle: d.subtitle.trim(),
        template: d.template,
        currency: store?.currency ?? "BDT",
        orderPrefix: d.orderPrefix,
        theme: themeWithOptions(store?.theme ?? {}, d.template, opts),
        orderCooldownHours: d.orderCooldownHours,
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

  // One row each for a picture, a text and a colour field, shared by the
  // Pictures and Text & colours cards and the template's group cards.
  const renderPicture = (slot: ContentField) => {
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
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className={cn(
              "h-14 w-26 shrink-0 rounded-lg border object-contain p-1",
              custom ? "border-solid bg-background" : "border-dashed bg-muted/40",
            )}
          />
        ) : (
          // An optional picture with no default: nothing shows yet.
          <div className="flex h-14 w-26 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-xs text-muted-foreground">
            None
          </div>
        )}
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
              {slot.defaultUrl ? "Default" : "Remove"}
            </Button>
          )}
        </div>
      </div>
    );
  };
  const renderText = (field: TextField) => (
    <Row key={field.key} label={field.label} htmlFor={`opt-${field.key}`} hint={field.hint}>
      <Input
        id={`opt-${field.key}`}
        className="w-90 max-w-full"
        maxLength={field.maxLength}
        placeholder={field.placeholder ?? field.defaultValue}
        value={opts[field.key] ?? ""}
        onChange={(e) => setOpts({ ...opts, [field.key]: e.target.value })}
      />
    </Row>
  );
  const renderColor = (field: ColorField) => {
    const typed = opts[field.key] ?? "";
    return (
      <Row key={field.key} label={field.label} htmlFor={`opt-${field.key}`} hint={field.hint}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${field.label} picker`}
            className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
            value={previewOptions[field.key]}
            onChange={(e) => setOpts({ ...opts, [field.key]: e.target.value })}
          />
          <Input
            id={`opt-${field.key}`}
            className="w-28 font-mono"
            maxLength={7}
            placeholder={field.defaultValue}
            value={typed}
            aria-invalid={(typed !== "" && !isHexColor(typed)) || undefined}
            onChange={(e) => setOpts({ ...opts, [field.key]: e.target.value.trim() })}
          />
          {typed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpts({ ...opts, [field.key]: "" })}
            >
              Default
            </Button>
          )}
        </div>
      </Row>
    );
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
            label="Subtitle"
            htmlFor="subtitle"
            hint="Optional. Shown after the name in the admin only, e.g. “Nature Bazar — Ecotine”"
          >
            <Input
              id="subtitle"
              className="w-90 max-w-full"
              maxLength={120}
              placeholder="Ecotine"
              value={d.subtitle}
              onChange={(e) => setD({ ...d, subtitle: e.target.value })}
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
          {narrowing && (
            <div
              role="alert"
              className="my-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <p className="font-semibold">
                {templateInfo(d.template).name} has no size picker
              </p>
              <p className="mt-1 text-pretty">
                It will sell only the default size of {liveProduct?.title}:{" "}
                <span className="font-medium">
                  {narrowing.sold.label || "the default"} at ৳{narrowing.sold.unitPrice}
                </span>
                . {narrowing.hidden.length === 1 ? "This size" : `These ${narrowing.hidden.length} sizes`}{" "}
                will not be offered until you switch back:{" "}
                {narrowing.hidden.map((v) => v.label || v.sku).join(", ")}. Orders already
                placed are not affected.
              </p>
              <label className="mt-3 flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={narrowingConfirmed}
                  onCheckedChange={(v) => setNarrowingConfirmed(v === true)}
                />
                I understand, sell only {narrowing.sold.label || "the default size"}
              </label>
            </div>
          )}
          <Row label="Repeat orders" hint="How long a phone number that ordered is refused another order">
            <Select
              value={String(d.orderCooldownHours)}
              onValueChange={(v) => setD({ ...d, orderCooldownHours: Number(v) })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* A value set outside these choices still shows, as hours. */}
                {(COOLDOWN_CHOICES.some((c) => c.hours === d.orderCooldownHours)
                  ? COOLDOWN_CHOICES
                  : [...COOLDOWN_CHOICES, { hours: d.orderCooldownHours, label: `${d.orderCooldownHours} hours` }]
                ).map((c) => (
                  <SelectItem key={c.hours} value={String(c.hours)}>
                    {c.label}
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

        {pictureSlots.length > 0 && (
          <Card
            title="Pictures"
            aside={`${customCount} of ${pictureSlots.length} replaced`}
            padded={false}
          >
            {pictureSlots.map(renderPicture)}
          </Card>
        )}

        {ownTexts.length + ownColors.length > 0 && (
          <Card title="Text & colours">
            {ownTexts.map(renderText)}
            {ownColors.map(renderColor)}
          </Card>
        )}

        {groups.map((group) => (
          <Card key={group} title={group} padded={false}>
            {slots.filter((f) => f.group === group).map(renderPicture)}
            <div className="px-5">
              {textFields.filter((f) => f.group === group).map(renderText)}
              {colorFields.filter((f) => f.group === group).map(renderColor)}
            </div>
          </Card>
        ))}

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
        options={previewOptions}
        className="xl:h-[calc(100vh-7rem)]"
      />
    </div>
  );
}

/**
 * The theme to save: the store's as it was, with the template's text and
 * colour keys set from the form, or removed when left empty so the template
 * default applies. Keys of other templates are kept, so switching back to
 * one finds its settings where they were.
 */
export function themeWithOptions(
  theme: Record<string, string>,
  template: string,
  opts: Record<string, string>,
): Record<string, string> {
  const info = templateInfo(template);
  const out = { ...theme };
  for (const field of [...info.texts, ...info.colors]) {
    const value = (opts[field.key] ?? "").trim();
    if (value) out[field.key] = value;
    else delete out[field.key];
  }
  return out;
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
