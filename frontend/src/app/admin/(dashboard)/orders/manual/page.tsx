"use client";

import Image from "next/image";
import * as React from "react";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";

import { useAuth } from "@/components/admin/auth-context";
import { OrderSummaryModal } from "@/components/admin/orders/order-summary-modal";
import { FraudCards } from "@/components/admin/orders/fraud-summary";
import { PreviousOrders } from "@/components/admin/orders/previous-orders";
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
import {
  createManualOrder,
  listProducts,
  getFraudCheck,
  lookupOrdersByPhone,
  type PhoneLookup,
} from "@/lib/api";
import type { FraudCheck } from "@/lib/orders";
import { cleanPhoneInput, toBdMobile } from "@/lib/phone";
import type { Order } from "@/lib/orders";
import { variantTitle, type Variant } from "@/lib/products";
import { notifyOrdersChanged } from "@/lib/use-order-counts";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";

// A version with its full name attached: what staff pick from and what the
// order line will record.
type Sellable = Variant & { title: string };
// priceOverride is unset until staff edit a line's price; until then the
// catalogue price applies, live, same as before this field existed.
type CartLine = { variant: Sellable; quantity: number; priceOverride?: number };

const NO_LOOKUP: PhoneLookup = { orders: [], incomplete: [] };

/** Wait this long after the last keystroke before looking the number up. */
const LOOKUP_DEBOUNCE_MS = 400;

export default function ManualOrderPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [approved, setApproved] = React.useState(true);
  const [phone, setPhone] = React.useState("");
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [comment, setComment] = React.useState("");

  const [products, setProducts] = React.useState<Sellable[]>([]);
  const [productSearch, setProductSearch] = React.useState("");
  const [cart, setCart] = React.useState<CartLine[]>([]);

  const [previous, setPrevious] = React.useState<PhoneLookup>(NO_LOOKUP);
  const [lookupLoading, setLookupLoading] = React.useState(false);
  // BDCourier courier history for the typed number; null until known, and
  // stays null when the store has no key (the request answers 503).
  const [fraud, setFraud] = React.useState<FraudCheck | null>(null);
  const [fraudLoading, setFraudLoading] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [askAdmin, setAskAdmin] = React.useState(false);
  // A previous order opened from the lookup results, read only.
  const [viewing, setViewing] = React.useState<Order | null>(null);

  React.useEffect(() => {
    // Every version of every product, flattened: a phone order can be for
    // anything in the catalogue, live or not.
    listProducts()
      .then((groups) =>
        setProducts(
          groups.flatMap((group) =>
            group.variants.map((variant) => ({
              ...variant,
              title: variantTitle(group.title, variant.label),
            }))
          )
        )
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load products")
      );
  }, []);

  const normalisedPhone = toBdMobile(phone);

  // Look the customer up as soon as the number is complete. Debounced, and
  // every stale response is dropped, so fast typing can't leave the panel
  // showing someone else's orders.
  React.useEffect(() => {
    if (!normalisedPhone) {
      setPrevious(NO_LOOKUP);
      setSearched(false);
      setLookupLoading(false);
      setFraud(null);
      setFraudLoading(false);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    setFraudLoading(true);
    setFraud(null);
    const timer = setTimeout(async () => {
      // Courier history in parallel with our own order lookup; neither
      // waits on the other, and a failure of either never blocks the form.
      getFraudCheck(normalisedPhone)
        .then((f) => {
          if (!cancelled) setFraud(f);
        })
        .catch(() => {
          if (!cancelled) setFraud(null);
        })
        .finally(() => {
          if (!cancelled) setFraudLoading(false);
        });
      try {
        const found = await lookupOrdersByPhone(normalisedPhone);
        if (cancelled) return;
        setPrevious(found);
        setSearched(true);
      } catch {
        // A failed lookup must never block taking the order.
        if (!cancelled) {
          setPrevious(NO_LOOKUP);
          setSearched(false);
        }
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalisedPhone]);

  const addToCart = (variant: Sellable) => {
    setCart((lines) => {
      const existing = lines.find((line) => line.variant.id === variant.id);
      if (existing) {
        return lines.map((line) =>
          line.variant.id === variant.id
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }
      return [...lines, { variant, quantity: 1 }];
    });
  };

  const setQuantity = (variantId: number, quantity: number) => {
    if (quantity < 1) return;
    setCart((lines) =>
      lines.map((line) =>
        line.variant.id === variantId ? { ...line, quantity } : line
      )
    );
  };

  const removeLine = (variantId: number) =>
    setCart((lines) => lines.filter((line) => line.variant.id !== variantId));

  const setLinePrice = (variantId: number, price: number) => {
    if (price < 0) return;
    setCart((lines) =>
      lines.map((line) =>
        line.variant.id === variantId ? { ...line, priceOverride: price } : line
      )
    );
  };

  const linePrice = (line: CartLine) =>
    line.priceOverride ?? line.variant.unitPrice;

  // Anything typed or added counts as work in progress. Not while saving: the
  // form clears itself on success, and prompting mid-submit would be absurd.
  const dirty =
    !saving &&
    (phone.trim().length > 0 ||
      name.trim().length > 0 ||
      address.trim().length > 0 ||
      comment.trim().length > 0 ||
      cart.length > 0);
  const guard = useUnsavedChanges(dirty);

  const handleAddProduct = () => {
    // A staff member cannot create catalogue rows, so rather than a dead
    // button they get told, in the language they work in, who can.
    // Through the guard, so a half-typed order is not lost on the way out.
    if (isSuperAdmin) guard.navigate("/admin/products");
    else setAskAdmin(true);
  };

  const total = cart.reduce((sum, line) => sum + linePrice(line) * line.quantity, 0);

  const filtered = products.filter((product) => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      product.title.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q)
    );
  });

  const valid =
    normalisedPhone !== null &&
    name.trim().length > 0 &&
    address.trim().length >= 4 &&
    cart.length > 0;

  const submit = async () => {
    if (!valid || !normalisedPhone) return;
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const order = await createManualOrder({
        customerName: name.trim(),
        phone: normalisedPhone,
        address: address.trim(),
        comment: comment.trim(),
        approved,
        items: cart.map((line) => ({
          variantId: line.variant.id,
          quantity: line.quantity,
          unitPriceOverride: line.priceOverride,
        })),
      });
      notifyOrdersChanged();
      setDone(
        `${order.orderNo} created — it is on the ${
          approved ? "Confirmed Order" : "Web Order List"
        } list.`
      );
      // Clear the customer, keep the mode: the next call is a different person
      // but almost always the same kind of order.
      setPhone("");
      setName("");
      setAddress("");
      setComment("");
      setCart([]);
      setPrevious(NO_LOOKUP);
      setSearched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-xl border bg-card p-2 shadow-xs">
        {(
          [
            ["manual", "Manual", false],
            ["approved", "Approved", true],
          ] as const
        ).map(([key, label, value]) => (
          <button
            key={key}
            type="button"
            onClick={() => setApproved(value)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              approved === value
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            {label}
          </button>
        ))}
        <p className="ml-2 text-xs text-muted-foreground">
          {approved
            ? "Goes straight to Confirmed Order."
            : "Goes to the Web Order List to be called through."}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {done && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {done}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="mo-phone">
                  Mobile Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mo-phone"
                  inputMode="numeric"
                  placeholder="01XXXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(cleanPhoneInput(e.target.value))}
                  aria-invalid={phone.length > 0 && !normalisedPhone}
                />
                {phone.length > 0 && !normalisedPhone && (
                  <p className="text-xs text-destructive">
                    Must be an 11-digit Bangladeshi mobile (01XXXXXXXXX).
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mo-name">
                  Customer Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mo-name"
                  placeholder="Customer name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="mo-address">
                  Address <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="mo-address"
                  rows={3}
                  placeholder="Enter address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mo-note">Note</Label>
                <Textarea
                  id="mo-note"
                  rows={3}
                  placeholder="Anything the courier or the next worker should know"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>
          </div>

          {normalisedPhone && (fraud || fraudLoading) && (
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <FraudCards fraud={fraud} loading={fraudLoading} />
            </div>
          )}

          <PreviousOrders
            lookup={previous}
            loading={lookupLoading}
            searched={searched}
            onOpen={setViewing}
          />

          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Products</h3>
              <Button variant="outline" size="sm" onClick={handleAddProduct}>
                <Plus className="size-4" />
                Add Product
              </Button>
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Input
                  placeholder="Search by name or SKU…"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
                <div className="max-h-96 divide-y overflow-y-auto rounded-lg border">
                  {filtered.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {products.length === 0
                        ? "No products yet."
                        : "Nothing matches that search."}
                    </p>
                  ) : (
                    filtered.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addToCart(product)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                      >
                        {product.imageUrl ? (
                          <Image
                            src={product.imageUrl}
                            alt=""
                            width={40}
                            height={40}
                            unoptimized
                            className="size-10 shrink-0 rounded-md border object-cover"
                          />
                        ) : (
                          <div className="size-10 shrink-0 rounded-md border border-dashed" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {product.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            SKU: {product.sku}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          ৳ {product.unitPrice}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Ordered products</span>
                  <span className="text-muted-foreground">
                    {cart.length} item{cart.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="min-h-24 rounded-lg border">
                  {cart.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                      Pick a product on the left to add it here.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {cart.map((line) => (
                        <li key={line.variant.id} className="p-3">
                          <div className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {line.variant.title}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0"
                              aria-label="Remove"
                              onClick={() => removeLine(line.variant.id)}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-7"
                              aria-label="Decrease quantity"
                              disabled={line.quantity <= 1}
                              onClick={() =>
                                setQuantity(line.variant.id, line.quantity - 1)
                              }
                            >
                              <Minus className="size-3" />
                            </Button>
                            <Input
                              className="h-7 w-14 text-center"
                              inputMode="numeric"
                              value={line.quantity}
                              onChange={(e) =>
                                setQuantity(
                                  line.variant.id,
                                  Number(e.target.value.replace(/\D/g, "")) || 1
                                )
                              }
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-7"
                              aria-label="Increase quantity"
                              onClick={() =>
                                setQuantity(line.variant.id, line.quantity + 1)
                              }
                            >
                              <Plus className="size-3" />
                            </Button>
                            <span className="ml-auto flex items-center gap-1 text-sm">
                              <span className="text-muted-foreground">৳</span>
                              <Input
                                className={cn(
                                  "h-7 w-16 text-right tabular-nums",
                                  line.priceOverride !== undefined &&
                                    line.priceOverride !== line.variant.unitPrice &&
                                    "border-amber-400 text-amber-700 dark:text-amber-400"
                                )}
                                inputMode="numeric"
                                aria-label="Unit price"
                                value={linePrice(line)}
                                onChange={(e) =>
                                  setLinePrice(
                                    line.variant.id,
                                    Number(e.target.value.replace(/\D/g, "")) || 0
                                  )
                                }
                              />
                            </span>
                            <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
                              ৳ {linePrice(line) * line.quantity}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex h-fit flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs lg:sticky lg:top-4">
          <h3 className="text-sm font-semibold">Order summary</h3>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Items total</dt>
              <dd className="tabular-nums">৳ {total}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="tabular-nums">৳ 0</dd>
            </div>
          </dl>
          <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2.5">
            <span className="text-sm font-semibold">Due amount</span>
            <span className="text-lg font-bold tabular-nums">৳ {total}</span>
          </div>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {approved ? "Create Approved Order" : "Create Manual Order"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Cash on delivery. The price comes from the catalogue.
          </p>
        </div>
      </div>

      <OrderSummaryModal
        order={viewing}
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />

      <Dialog
        open={guard.pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) guard.stay();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave without creating the order?</DialogTitle>
            <DialogDescription>
              You have started a manual order. The customer, the note and the
              cart will be lost if you leave this page now.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={guard.leave}>
              Leave
            </Button>
            <Button onClick={guard.stay}>Stay on this page</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={askAdmin} onOpenChange={setAskAdmin}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>নতুন প্রোডাক্ট যোগ করা যাবে না</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  নতুন প্রোডাক্ট শুধু সুপার অ্যাডমিন যোগ করতে পারেন। প্রোডাক্ট
                  যোগ করতে চাইলে অ্যাডমিনের সাথে যোগাযোগ করুন।
                </p>
                <p>
                  ততক্ষণ পর্যন্ত তালিকায় থাকা প্রোডাক্ট দিয়ে অর্ডার নেওয়া যাবে।
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAskAdmin(false)}>ঠিক আছে</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
