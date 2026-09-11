"use client";

import * as React from "react";
import { ArrowLeft, ExternalLink, Phone } from "lucide-react";

import { useAuth } from "@/components/admin/auth-context";
import { FraudCards } from "@/components/admin/orders/fraud-summary";
import { OrderTags } from "@/components/admin/orders/order-tags";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { recheckOrderFraud, updateOrder } from "@/lib/api";
import {
  CHANGE_STATUS_OPTIONS,
  ORDER_SOURCE_LABELS,
  ORDER_STATUS_LABELS,
  SOURCE_BADGE_CLASS,
  STATUS_BADGE_CLASS,
  STATUS_PAGES,
  activeClaim,
  formatOrderDateTime,
  staffLabel,
  timeAgo,
  type Order,
  type OrderStatus,
} from "@/lib/orders";
import { toBdMobile } from "@/lib/phone";
import { cn } from "@/lib/utils";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export function OrderDetailsModal({
  order,
  open,
  onOpenChange,
  onOrderUpdated,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderUpdated: (order: Order) => void;
}) {
  const { user } = useAuth();
  const [pendingStatus, setPendingStatus] = React.useState<OrderStatus | null>(
    null
  );
  const [note, setNote] = React.useState("");
  const [discount, setDiscount] = React.useState("");
  const [editName, setEditName] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [rechecking, setRechecking] = React.useState(false);
  const [editAddress, setEditAddress] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Unsaved edits are reviewed before a status change or before closing:
  // which of the two the person was doing decides what happens after Save.
  const [review, setReview] = React.useState<"status" | "close" | null>(null);

  React.useEffect(() => {
    if (order) {
      setPendingStatus(null);
      setNote(order.comment);
      setDiscount("");
      setEditName(order.customerName);
      setEditPhone(order.phone);
      setEditAddress(order.address);
      setError(null);
      setReview(null);
    }
  }, [order?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // A silent retry when the courier history is missing or last errored — an
  // outage or a store that only just got its BDCourier key configured. Not
  // forced, so a fresh-enough cached answer is reused rather than spending
  // another API call; a real result (even "0 parcels") is left alone.
  React.useEffect(() => {
    if (!open || !order) return;
    if (order.fraud && !order.fraud.error) return;
    let cancelled = false;
    recheckOrderFraud(order.id, false)
      .then((updated) => {
        if (!cancelled) onOrderUpdated(updated);
      })
      .catch(() => {
        // Still nothing to show; the card just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [open, order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return null;

  const claim = activeClaim(order);

  // Orders written before line items existed carry only the summary columns,
  // so fall back to a single synthetic line rather than showing an empty list.
  const lines =
    order.items.length > 0
      ? order.items
      : [
          {
            id: 0,
            productId: null,
            productName: order.product,
            unitPrice: order.unitPrice,
            quantity: order.quantity,
            lineTotal: order.total,
          },
        ];

  const discountAmount = Math.min(
    Math.max(Number(discount) || 0, 0),
    order.total
  );
  const grandTotal = order.total - discountAmount;

  // Every field edit that hasn't reached the server yet, for the review
  // prompt. Blank name/phone/address are ignored: the server rejects them.
  const changes: { field: string; from: string; to: string }[] = [];
  if (editName.trim() && editName.trim() !== order.customerName) {
    changes.push({ field: "Name", from: order.customerName, to: editName.trim() });
  }
  // Phones are stored in the courier's 01XXXXXXXXX form; a number that can't
  // be read that way is flagged rather than saved.
  const phoneNormalised = editPhone.trim() ? toBdMobile(editPhone) : null;
  const phoneInvalid = editPhone.trim() !== "" && phoneNormalised === null;
  if (phoneNormalised && phoneNormalised !== order.phone) {
    changes.push({ field: "Phone", from: order.phone, to: phoneNormalised });
  }
  if (editAddress.trim() && editAddress.trim() !== order.address) {
    changes.push({ field: "Address", from: order.address, to: editAddress.trim() });
  }
  if (note !== order.comment) {
    changes.push({ field: "Note", from: order.comment, to: note });
  }
  const detailsPatch = {
    customerName: editName.trim() || undefined,
    phone: phoneNormalised ?? undefined,
    address: editAddress.trim() || undefined,
    comment: note !== order.comment ? note : undefined,
  };

  const discardEdits = () => {
    setEditName(order.customerName);
    setEditPhone(order.phone);
    setEditAddress(order.address);
    setNote(order.comment);
  };

  // "Update": save the edits along with the status, after a look at them.
  const requestStatusChange = () => {
    if (!pendingStatus) return;
    if (changes.length) setReview("status");
    else void run({ status: pendingStatus });
  };

  // Closing (Back, Escape, overlay click): unsaved edits get a chance first.
  const requestClose = () => {
    if (changes.length && !busy) setReview("close");
    else onOpenChange(false);
  };

  const saveReviewed = async () => {
    const intent = review;
    setReview(null);
    const ok = await run({
      ...detailsPatch,
      status: intent === "status" && pendingStatus ? pendingStatus : undefined,
    });
    if (ok && intent === "close") onOpenChange(false);
  };

  const discardReviewed = () => {
    const intent = review;
    setReview(null);
    discardEdits();
    if (intent === "status" && pendingStatus) void run({ status: pendingStatus });
    if (intent === "close") onOpenChange(false);
  };

  const run = async (patch: {
    status?: OrderStatus;
    comment?: string;
    customerName?: string;
    phone?: string;
    address?: string;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateOrder(order.id, patch);
      onOrderUpdated(updated);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0 border-b px-6 py-4">
          <div>
            <DialogTitle>Web Order Details</DialogTitle>
            <DialogDescription>
              Review and manage this web order
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            {claim && (
              <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current" />
                Processing · {claim.id === user.id ? "you" : claim.label}
              </Badge>
            )}
            <Badge className={cn("border-transparent", STATUS_BADGE_CLASS[order.status])}>
              {ORDER_STATUS_LABELS[order.status]}
            </Badge>
            <Badge
              className={cn(
                "border-transparent",
                SOURCE_BADGE_CLASS[order.source]
              )}
            >
              {ORDER_SOURCE_LABELS[order.source]}
            </Badge>
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Created&nbsp;
              <span className="font-medium text-foreground">
                {timeAgo(order.createdAt)}
              </span>
            </Badge>
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Updated&nbsp;
              <span className="font-medium text-foreground">
                {timeAgo(order.updatedAt)}
              </span>
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
          {/* The customer's courier history, first and full width: it is
              what decides how the call goes. Refresh asks BDCourier again. */}
          {order.fraud && (
            <FraudCards
              fraud={order.fraud}
              onRefresh={async () => {
                setRechecking(true);
                try {
                  onOrderUpdated(await recheckOrderFraud(order.id));
                } catch {
                  // The card keeps the previous answer; nothing else to do.
                } finally {
                  setRechecking(false);
                }
              }}
              refreshing={rechecking}
            />
          )}
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          {/* Main column */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <SectionLabel>Customer details</SectionLabel>
              <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Mobile Number</Label>
                  <div className="relative">
                    <Input
                      type="tel"
                      inputMode="numeric"
                      value={editPhone}
                      onChange={(e) =>
                        setEditPhone(e.target.value.replace(/[^0-9+]/g, ""))
                      }
                      className={cn("pr-9", phoneInvalid && "border-destructive")}
                      aria-invalid={phoneInvalid || undefined}
                    />
                    <div className="absolute inset-y-0 right-3 flex items-center">
                      <a
                        href={`tel:${order.phone}`}
                        title="Call"
                        className="text-green-600 hover:text-green-700"
                      >
                        <Phone className="size-4" />
                      </a>
                    </div>
                  </div>
                  {phoneInvalid && (
                    <p className="text-xs text-destructive">
                      Needs 11 digits starting with 01 — the courier rejects anything else.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Shipping &amp; address</SectionLabel>
              <div className="rounded-xl border p-4">
                <div className="space-y-1.5">
                  <Label>Address</Label>
                  <Textarea
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <SectionLabel>Ordered products</SectionLabel>
                <Badge variant="secondary" className="rounded-sm">
                  {lines.length}
                </Badge>
              </div>
              <div className="flex flex-col gap-3">
                {lines.map((line, index) => (
                  <div key={line.id ?? index} className="rounded-xl border p-4">
                    <p className="text-sm font-medium">{line.productName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      ৳{line.unitPrice.toLocaleString()} each
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Qty</Label>
                        <Input readOnly value={line.quantity} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Price</Label>
                        <Input readOnly value={line.unitPrice} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Total</Label>
                        <Input readOnly value={line.lineTotal.toFixed(2)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Order total</SectionLabel>
              <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Discount</Label>
                  <Input
                    type="number"
                    min={0}
                    max={order.total}
                    placeholder="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sub Total</Label>
                  <Input readOnly value={order.total} />
                </div>
                <div className="space-y-1.5">
                  <Label>Delivery Charge</Label>
                  <Input readOnly value="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-destructive">Grand Total</Label>
                  <Input
                    readOnly
                    value={grandTotal}
                    className="border-destructive/50 text-destructive"
                  />
                </div>
              </div>
            </div>

            {order.status !== "confirmed" && order.status !== "shipped" && (
              <div className="flex flex-col gap-1.5">
                <Button
                  size="lg"
                  disabled={busy}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => run({ status: "confirmed" })}
                >
                  Approve Order (৳{grandTotal.toLocaleString()})
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Marks the order Confirmed and moves it to Confirmed Order.
                </p>
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <SectionLabel>Order summary</SectionLabel>
                <span className="text-sm text-muted-foreground">
                  #{order.orderNo}
                </span>
              </div>
              <div className="rounded-xl border p-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Date</p>
                    <p className="mt-0.5 font-medium">
                      {formatOrderDateTime(order.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Status</p>
                    <p className="mt-0.5 font-medium">
                      {ORDER_STATUS_LABELS[order.status]}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Payment</p>
                    <p className="mt-0.5 font-medium">COD</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Source</p>
                    <p className="mt-0.5 font-medium">
                      {ORDER_SOURCE_LABELS[order.source]}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Staff</p>
                    <p
                      className="mt-0.5 font-medium"
                      title={order.staffName ?? undefined}
                    >
                      {order.staffName ? (
                        staffLabel(order.staffName, order.staffNickname)
                      ) : (
                        <span className="text-muted-foreground">
                          Not handled yet
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {order.pathaoConsignmentId && (
                  <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground uppercase">Pathao</p>
                      {order.pathaoStatus && (
                        <span className="text-xs font-medium">{order.pathaoStatus}</span>
                      )}
                    </div>
                    <a
                      href={order.pathaoTrackingUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-mono text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-400"
                    >
                      {order.pathaoConsignmentId}
                      <ExternalLink className="size-3.5" />
                    </a>
                    {order.pathaoDeliveryFee !== null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Delivery fee ৳{order.pathaoDeliveryFee}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-4 rounded-lg bg-muted/50 p-3">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{order.total}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-muted-foreground">
                    <span>Delivery</span>
                    <span>0</span>
                  </div>
                  <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                    <span>Total</span>
                    <span>{order.total}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Order tags</SectionLabel>
              <div className="rounded-xl border p-4">
                <OrderTags order={order} onOrderUpdated={onOrderUpdated} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Order actions</SectionLabel>
              <div className="flex flex-col gap-3 rounded-xl border p-4">
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <div className="flex items-center gap-2">
                  <Select
                    value={pendingStatus ?? undefined}
                    onValueChange={(v) => setPendingStatus(v as OrderStatus)}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Change status" />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANGE_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={
                      busy || !pendingStatus || pendingStatus === order.status
                    }
                    className="bg-emerald-500 text-white hover:bg-emerald-600"
                    onClick={requestStatusChange}
                  >
                    Update
                  </Button>
                  <Button variant="outline" onClick={requestClose}>
                    <ArrowLeft className="mr-1 size-4" />
                    Back
                  </Button>
                </div>
                {pendingStatus && pendingStatus !== order.status && (
                  <p className="text-xs text-muted-foreground">
                    Moves this order to{" "}
                    <span className="font-medium text-foreground">
                      {STATUS_PAGES[pendingStatus].title}
                    </span>
                    .
                  </p>
                )}
                <div className="rounded-lg border p-3">
                  <Label className="mb-1.5 block">Note</Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={busy || note === order.comment}
                    onClick={() => run({ comment: note })}
                  >
                    Add Note
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </DialogContent>

      <Dialog open={review !== null} onOpenChange={(next) => !next && setReview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              {review === "status"
                ? "Save these edits together with the status change, or discard them and change only the status?"
                : "Save these edits before closing, or discard them?"}
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-[50svh] flex-col gap-2 overflow-y-auto text-sm">
            {changes.map((change) => (
              <li key={change.field} className="rounded-lg border p-3">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {change.field}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground line-through">
                  {change.from || <span className="italic no-underline">empty</span>}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap font-medium">
                  {change.to || <span className="italic">empty</span>}
                </p>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={discardReviewed} disabled={busy}>
              Discard
            </Button>
            <Button
              className="bg-emerald-500 text-white hover:bg-emerald-600"
              onClick={saveReviewed}
              disabled={busy}
            >
              {review === "status" ? "Save & update" : "Save & close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
