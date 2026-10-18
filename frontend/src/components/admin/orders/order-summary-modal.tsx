"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ORDER_SOURCE_LABELS,
  ORDER_STATUS_LABELS,
  SOURCE_BADGE_CLASS,
  STATUS_BADGE_CLASS,
  courierLabel,
  courierStatusLabel,
  formatOrderDateTime,
  staffLabel,
  type Order,
} from "@/lib/orders";
import { cn } from "@/lib/utils";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm">{children || "—"}</dd>
    </div>
  );
}

/**
 * A whole order, read only.
 *
 * Opened from the phone-lookup results while staff are taking a new order, so
 * they can answer "what did I order last time?" without leaving a half-filled
 * form behind on another page. Nothing here is editable on purpose: this is a
 * reference card for a live phone call, and the order being read may well
 * belong to a list someone else is working.
 */
export function OrderSummaryModal({
  order,
  open,
  onOpenChange,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!order) return null;

  // Orders written before line items existed carry only the summary columns.
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

  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const itemsTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{order.orderNo}</span>
            <Badge
              variant="secondary"
              className={cn("font-medium", STATUS_BADGE_CLASS[order.status])}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </Badge>
            <Badge
              variant="secondary"
              className={cn("font-medium", SOURCE_BADGE_CLASS[order.source])}
            >
              {ORDER_SOURCE_LABELS[order.source]}
            </Badge>
            {order.autoCaptured && (
              <Badge variant="outline">Form never submitted</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Placed {formatOrderDateTime(order.createdAt)}
            {order.updatedAt !== order.createdAt &&
              ` · updated ${formatOrderDateTime(order.updatedAt)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Customer</h3>
            <dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
              <Field label="Name">{order.customerName}</Field>
              <Field label="Phone">
                <span className="font-mono">{order.phone}</span>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address">{order.address}</Field>
              </div>
              {order.comment && (
                <div className="sm:col-span-2">
                  <Field label="Note">{order.comment}</Field>
                </div>
              )}
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Products{" "}
              <span className="font-normal text-muted-foreground">
                ({lines.length} line{lines.length === 1 ? "" : "s"}, {units}{" "}
                item{units === 1 ? "" : "s"})
              </span>
            </h3>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-table-header text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Product</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.id || index} className="border-t">
                      <td className="px-4 py-2.5">{line.productName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {line.quantity}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        ৳ {line.unitPrice}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        ৳ {line.lineTotal}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={3} className="px-4 py-2 text-right">
                      Items total
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      ৳ {itemsTotal}
                    </td>
                  </tr>
                  <tr className="border-t bg-table-header">
                    <td colSpan={3} className="px-4 py-2.5 text-right font-semibold">
                      Order total
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                      ৳ {order.total}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Fulfilment</h3>
            <dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
              <Field label="Sticker printed">
                {order.printed ? "Yes" : "No"}
              </Field>
              <Field label="Handed to courier">
                {order.courier ? "Yes" : "No"}
              </Field>
              <Field label={`${courierLabel(order)} consignment`}>
                {order.courierConsignmentId ? (
                  <span className="font-mono">{order.courierConsignmentId}</span>
                ) : null}
              </Field>
              <Field label="Delivery status">
                {courierStatusLabel(order.courierStatus) || null}
              </Field>
              {order.courierDeliveryFee !== null && (
                <Field label="Delivery fee">৳ {order.courierDeliveryFee}</Field>
              )}
              {order.courierSentAt && (
                <Field label={`Sent to ${courierLabel(order)}`}>
                  {formatOrderDateTime(order.courierSentAt)}
                </Field>
              )}
              <Field label="Handled by">
                {staffLabel(order.staffName, order.staffNickname)}
              </Field>
              {order.assignedToName && (
                <Field label="Assigned to">
                  {staffLabel(order.assignedToName, order.assignedToNickname)}
                </Field>
              )}
            </dl>
          </section>

          {order.tags.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {order.tags.map((tag) => (
                  <Badge key={tag.id} variant="secondary">
                    {tag.label}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
