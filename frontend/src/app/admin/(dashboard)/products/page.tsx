"use client";

import Image from "next/image";
import * as React from "react";

import { useAuth } from "@/components/admin/auth-context";
import { ProductEditor } from "@/components/admin/products/product-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  activateProduct,
  deleteProduct,
  listProducts,
  saveProduct,
  uploadVariantImage,
  type ProductSaveInput,
} from "@/lib/api";
import type { Product } from "@/lib/products";
import { templateInfo } from "@/templates/catalog";

/**
 * The catalogue. A product is a group — a name and a description — and its
 * versions are what actually sell: each with its own size, price and picture.
 * Exactly one product is live at a time; the landing page shows it with all
 * of its versions, the default one selected.
 *
 * The page itself only reads. Everything about a product — name, versions,
 * default, description — is changed in one editor dialog and saved together.
 */
export default function ProductsPage() {
  const { store } = useAuth();
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [editor, setEditor] = React.useState<{
    open: boolean;
    editing: Product | null;
  }>({ open: false, editing: null });

  const refresh = React.useCallback(async () => {
    try {
      setProducts(await listProducts());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * One request saves the name, the versions and the description; the
   * pictures follow, one upload per row that picked a file, addressed by the
   * ids the save answered with. A picture that fails to upload leaves the
   * product saved and says so, rather than losing everything typed.
   */
  const handleSave = async (input: ProductSaveInput, images: (File | null)[]) => {
    const { product, variantIds } = await saveProduct(
      input,
      editor.editing?.id ?? null
    );
    try {
      for (const [index, file] of images.entries()) {
        if (file) await uploadVariantImage(product.id, variantIds[index], file);
      }
    } finally {
      await refresh();
    }
  };

  const run = async (fallback: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const activate = (product: Product) =>
    run("Could not make this product live", async () => {
      setProducts(await activateProduct(product.id));
    });

  const remove = (product: Product) => {
    if (
      !window.confirm(
        `Delete "${product.title}" and all its versions? Past orders keep the name and price they recorded.`
      )
    ) {
      return;
    }
    run("Could not delete", async () => {
      await deleteProduct(product.id);
      await refresh();
    });
  };

  // The store's template decides whether the versions are even offered: a
  // campaign template has no picker and sells the default one only. Staff
  // adding versions here would otherwise expect them to appear on the page.
  const template = templateInfo(store?.template ?? "classic");
  const live = products.find((p) => p.isActive) ?? null;
  const soldOnly =
    template.singleVariant && live && live.variants.length > 1
      ? (live.variants.find((v) => v.isDefault) ?? live.variants[0])
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          One product is live at a time, with all of its versions on the
          landing page. Making another live swaps the page immediately.
        </p>
        <Button onClick={() => setEditor({ open: true, editing: null })}>
          Add product
        </Button>
      </div>

      {soldOnly && (
        <div
          role="note"
          lang="bn"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <p className="font-semibold">
            এই স্টোরের টেমপ্লেট ({template.name}) এ সাইজ বাছাইয়ের অপশন নেই।
          </p>
          <p className="mt-1 text-pretty">
            ল্যান্ডিং পেজে শুধু ডিফল্ট ভার্সন{" "}
            <span className="font-medium">
              {soldOnly.label || live?.title} (৳{soldOnly.unitPrice})
            </span>{" "}
            বিক্রি হবে। বাকি {live ? live.variants.length - 1 : 0} টি ভার্সন কাস্টমার
            দেখতে বা অর্ডার করতে পারবে না। নতুন ভার্সন যোগ করলে সেটাও দেখাবে না, যতক্ষণ না
            টেমপ্লেট বদলানো হয় বা সেটাকে ডিফল্ট করা হয়।
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground shadow-xs">
          Loading…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground shadow-xs">
          No products yet. Add one to start selling.
        </div>
      ) : (
        products.map((product) => (
          <section
            key={product.id}
            className="rounded-xl border bg-card p-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{product.title}</h2>
                  {product.isActive ? (
                    <Badge>Live</Badge>
                  ) : (
                    <Badge variant="secondary">Not live</Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                  {product.description || "No description yet."}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {!product.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => activate(product)}
                  >
                    Make live
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditor({ open: true, editing: product })}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  // The live product has no replacement until another is
                  // made live, so the API refuses this too.
                  disabled={busy || product.isActive}
                  onClick={() => remove(product)}
                >
                  Delete
                </Button>
              </div>
            </div>

            <Table className="mt-3">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Image</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="w-24 text-right">Price</TableHead>
                  <TableHead className="w-16 text-right">Qty</TableHead>
                  <TableHead className="w-36">SKU</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell>
                      {variant.imageUrl ? (
                        <Image
                          src={variant.imageUrl}
                          alt=""
                          width={40}
                          height={40}
                          unoptimized
                          className="size-10 rounded-md border object-cover"
                        />
                      ) : (
                        <div className="size-10 rounded-md border border-dashed" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {variant.label || (
                        <span className="text-muted-foreground">
                          (no size — shows as the product name)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ৳ {variant.unitPrice}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {variant.defaultQuantity}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {variant.sku}
                    </TableCell>
                    <TableCell>
                      {variant.isDefault ? (
                        <Badge variant="outline">Default</Badge>
                      ) : (
                        product.isActive &&
                        template.singleVariant && (
                          <Badge
                            variant="outline"
                            lang="bn"
                            className="border-amber-300 text-amber-800 dark:text-amber-300"
                          >
                            পেজে নেই
                          </Badge>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))
      )}

      <ProductEditor
        product={editor.editing}
        open={editor.open}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        onSave={handleSave}
      />
    </div>
  );
}
