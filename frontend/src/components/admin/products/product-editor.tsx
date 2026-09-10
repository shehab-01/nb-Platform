"use client";

import Image from "next/image";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uuid } from "@/lib/uuid";
import type { ProductSaveInput } from "@/lib/api";
import { variantTitle, type Product } from "@/lib/products";

/** One version as the editor holds it, plus the picture picked for it. */
type Row = {
  /** Stable key for React; new rows have no id yet. */
  key: string;
  id: number | null;
  label: string;
  unitPrice: number;
  defaultQuantity: number;
  sku: string;
  isDefault: boolean;
  imageUrl: string | null;
  file: File | null;
};

type Draft = { title: string; description: string; rows: Row[] };

function newRow(isDefault: boolean): Row {
  return {
    key: uuid(),
    id: null,
    label: "",
    unitPrice: 0,
    defaultQuantity: 1,
    sku: "",
    isDefault,
    imageUrl: null,
    file: null,
  };
}

function fromProduct(product: Product | null): Draft {
  if (!product) {
    return { title: "", description: "", rows: [newRow(true)] };
  }
  return {
    title: product.title,
    description: product.description,
    rows: product.variants.map((v) => ({
      key: String(v.id),
      id: v.id,
      label: v.label,
      unitPrice: v.unitPrice,
      defaultQuantity: v.defaultQuantity,
      sku: v.sku,
      isDefault: v.isDefault,
      imageUrl: v.imageUrl,
      file: null,
    })),
  };
}

/** What "unsaved changes" compares: everything but the blob previews. */
function fingerprint(draft: Draft): string {
  return JSON.stringify({
    title: draft.title,
    description: draft.description,
    rows: draft.rows.map((r) => ({
      id: r.id,
      label: r.label,
      unitPrice: r.unitPrice,
      defaultQuantity: r.defaultQuantity,
      sku: r.sku,
      isDefault: r.isDefault,
      file: r.file ? r.file.name + r.file.size : null,
    })),
  });
}

/**
 * The one place a product is made or changed: its name at the top, then its
 * versions — each with a size, price, quantity, SKU, picture and the radio
 * that makes it the default — then the description. Everything is held here
 * as a draft and saved together on Save; closing with unsaved changes asks
 * first, so a half-built product is never lost to a stray click outside.
 */
export function ProductEditor({
  product,
  open,
  onOpenChange,
  onSave,
}: {
  /** The product being edited, or null to add a new one. */
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Save the draft; the files are the pictures picked, by row index. */
  onSave: (
    input: ProductSaveInput,
    images: (File | null)[]
  ) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => fromProduct(null));
  const initial = React.useRef("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = React.useState(false);

  // Reset every time the dialog opens, so a cancelled edit never leaks into
  // the next one.
  React.useEffect(() => {
    if (!open) return;
    const fresh = fromProduct(product);
    setDraft(fresh);
    initial.current = fingerprint(fresh);
    setError(null);
    setConfirmLeave(false);
  }, [open, product]);

  const dirty = fingerprint(draft) !== initial.current;

  // Escape, the overlay and the Cancel button all come through here. With
  // unsaved changes the dialog stays and asks; otherwise it just closes.
  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (dirty && !busy) setConfirmLeave(true);
    else onOpenChange(false);
  };

  const set = (patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const setRow = (key: string, patch: Partial<Row>) =>
    setDraft((d) => ({
      ...d,
      rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }));

  const makeDefault = (key: string) =>
    setDraft((d) => ({
      ...d,
      rows: d.rows.map((r) => ({ ...r, isDefault: r.key === key })),
    }));

  const addRow = () =>
    setDraft((d) => ({ ...d, rows: [...d.rows, newRow(d.rows.length === 0)] }));

  // The default cannot simply vanish: if it goes, the first remaining row
  // takes over, which is what a customer would have seen first anyway.
  const removeRow = (key: string) =>
    setDraft((d) => {
      const rows = d.rows.filter((r) => r.key !== key);
      if (rows.length > 0 && !rows.some((r) => r.isDefault)) {
        rows[0] = { ...rows[0], isDefault: true };
      }
      return { ...d, rows };
    });

  const valid =
    draft.title.trim().length > 0 &&
    draft.rows.length > 0 &&
    draft.rows.every(
      (r) => r.sku.trim().length > 0 && r.unitPrice > 0 && r.defaultQuantity >= 1
    );

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(
        {
          title: draft.title.trim(),
          description: draft.description.trim(),
          variants: draft.rows.map((r) => ({
            id: r.id,
            label: r.label.trim(),
            unitPrice: r.unitPrice,
            defaultQuantity: r.defaultQuantity,
            sku: r.sku.trim(),
            isDefault: r.isDefault,
          })),
        },
        draft.rows.map((r) => r.file)
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{product ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>
            The name is the heading on the landing page; each version adds
            its size after it. Nothing is saved until you press Save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid gap-6">
            {/* --- Name ------------------------------------------------- */}
            <div className="grid gap-2">
              <Label htmlFor="pe-title">Name</Label>
              <Input
                id="pe-title"
                value={draft.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="স্পেশাল আচার কম্বো"
                autoFocus
              />
            </div>

            {/* --- Versions --------------------------------------------- */}
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Versions</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The sizes the customer picks between. The default is the
                    one selected when the page loads.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={addRow}>
                  <Plus className="size-4" />
                  Add version
                </Button>
              </div>

              <div className="grid gap-2">
                {draft.rows.map((row, index) => (
                  <VersionRow
                    key={row.key}
                    row={row}
                    index={index}
                    productTitle={draft.title}
                    onChange={(patch) => setRow(row.key, patch)}
                    onDefault={() => makeDefault(row.key)}
                    onRemove={() => removeRow(row.key)}
                    removable={draft.rows.length > 1}
                  />
                ))}
              </div>
            </div>

            {/* --- Description ------------------------------------------ */}
            <div className="grid gap-2">
              <Label htmlFor="pe-description">Description</Label>
              <Textarea
                id="pe-description"
                rows={8}
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What is in it, why it is good. Leave a blank line between paragraphs."
              />
              <p className="text-xs text-muted-foreground">
                Shows under the fold on the landing page. Plain text for now;
                a proper editor is coming. Empty hides the section.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="ghost" onClick={() => requestClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? "Saving…" : product ? "Save changes" : "Add product"}
          </Button>
        </DialogFooter>

        <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Leave without saving?</DialogTitle>
              <DialogDescription>
                {product
                  ? "The changes to this product will be lost."
                  : "This product has not been saved and will be lost."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmLeave(false);
                  onOpenChange(false);
                }}
              >
                Leave
              </Button>
              <Button onClick={() => setConfirmLeave(false)}>Stay</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/** One version's fields on a line, with its picture and the default radio. */
function VersionRow({
  row,
  index,
  productTitle,
  onChange,
  onDefault,
  onRemove,
  removable,
}: {
  row: Row;
  index: number;
  productTitle: string;
  onChange: (patch: Partial<Row>) => void;
  onDefault: () => void;
  onRemove: () => void;
  removable: boolean;
}) {
  // A blob URL has to be revoked or the file stays in memory for the session.
  const [preview, setPreview] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!row.file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(row.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [row.file]);
  const shown = preview ?? row.imageUrl;
  const id = (field: string) => `pe-v${index}-${field}`;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="pe-default"
            className="size-4 accent-primary"
            checked={row.isDefault}
            onChange={onDefault}
          />
          <span className={row.isDefault ? "font-medium" : "text-muted-foreground"}>
            {row.isDefault ? "Default" : "Make default"}
          </span>
        </label>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
          {productTitle.trim()
            ? variantTitle(productTitle.trim(), row.label.trim() || "…")
            : ""}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Remove version"
          disabled={!removable}
          onClick={onRemove}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_6rem_5rem_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor={id("label")} className="text-xs">
            Size
          </Label>
          <Input
            id={id("label")}
            value={row.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="২ কেজি"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("price")} className="text-xs">
            Price (৳)
          </Label>
          <Input
            id={id("price")}
            type="number"
            min={1}
            value={row.unitPrice || ""}
            onChange={(e) =>
              onChange({ unitPrice: Number(e.target.value) || 0 })
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("qty")} className="text-xs">
            Qty
          </Label>
          <Input
            id={id("qty")}
            type="number"
            min={1}
            max={99}
            value={row.defaultQuantity}
            onChange={(e) =>
              onChange({ defaultQuantity: Number(e.target.value) || 1 })
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("sku")} className="text-xs">
            SKU
          </Label>
          <Input
            id={id("sku")}
            value={row.sku}
            onChange={(e) => onChange({ sku: e.target.value })}
            placeholder="achar-2kg"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {shown ? (
          <Image
            src={shown}
            alt=""
            width={48}
            height={48}
            unoptimized
            className="size-12 shrink-0 rounded-md border object-cover"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">
            No image
          </div>
        )}
        <Input
          id={id("image")}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="max-w-xs"
          onChange={(e) => onChange({ file: e.target.files?.[0] ?? null })}
        />
      </div>
    </div>
  );
}
