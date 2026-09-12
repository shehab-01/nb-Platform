"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, ExternalLink, Lock } from "lucide-react";

import { SortableHeader } from "@/components/admin/data-table/data-table-sort-header";
import { FraudBadge } from "@/components/admin/orders/fraud-summary";
import { OrderTags } from "@/components/admin/orders/order-tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ORDER_SOURCE_LABELS,
  SOURCE_BADGE_CLASS,
  activeClaim,
  formatOrderDateTime,
  timeAgo,
  staffLabel,
  type Order,
} from "@/lib/orders";
import { cn } from "@/lib/utils";

/** A tick when the flag is set, blank when it isn't. */
function FlagCell({ on }: { on: boolean }) {
  return on ? (
    <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
  ) : (
    <span className="sr-only">No</span>
  );
}

/** The consignment id as a link to Pathao's tracking page. */
function PathaoCell({ order }: { order: Order }) {
  if (!order.pathaoConsignmentId) {
    return <span className="sr-only">Not sent</span>;
  }
  return (
    <a
      href={order.pathaoTrackingUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
      onClick={(event) => event.stopPropagation()}
    >
      {order.pathaoConsignmentId}
      <ExternalLink className="size-3" />
    </a>
  );
}

// Pathao's own status words, toned by what they mean. Order matters: partial
// delivery is checked before "deliver" would claim it.
const DELIVERY_TONES: [RegExp, string][] = [
  [/partial/, "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"],
  [/deliver/, "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"],
  [/return|cancel/, "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"],
];

/**
 * Where the parcel is, as Pathao last said. Kept current by the API's own
 * polling, so staff can archive an order before it is delivered and still
 * see the delivery land later.
 */
function DeliveryCell({ order }: { order: Order }) {
  if (!order.pathaoConsignmentId) {
    return <span className="text-xs text-muted-foreground">Not sent</span>;
  }
  const status = order.pathaoStatus ?? "Pending";
  const tone =
    DELIVERY_TONES.find(([re]) => re.test(status.toLowerCase()))?.[1] ??
    "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300";
  return (
    <Badge variant="secondary" className={cn("font-medium", tone)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function getOrderColumns({
  onOpen,
  onOrderUpdated,
  currentUserId,
}: {
  onOpen: (order: Order) => void;
  onOrderUpdated: (order: Order) => void;
  currentUserId: number;
}): ColumnDef<Order>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "createdAt",
      meta: { label: "Created At" },
      header: ({ column }) => (
        <SortableHeader
          label="Created At"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {formatOrderDateTime(row.original.createdAt)}
          </span>
          <span className="text-xs text-muted-foreground">
            ID: {row.original.orderNo}
          </span>
        </div>
      ),
      filterFn: () => true,
    },
    {
      id: "landTime",
      meta: { label: "Land Time" },
      header: "Land Time",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {timeAgo(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "customerName",
      meta: { label: "Customer" },
      header: "Customer",
      cell: ({ row }) => (
        // Wraps inside a fixed width: the table cell is nowrap by default,
        // and a long name must fold onto more lines, never widen the table.
        <div className="flex max-w-[200px] flex-col gap-0.5 whitespace-normal break-words">
          <span className="font-medium">
            {row.original.customerName || (
              <span className="text-muted-foreground">No name given</span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.original.phone}
          </span>
          {row.original.autoCaptured && (
            <Badge
              variant="outline"
              className="mt-0.5 w-fit border-amber-500/40 bg-amber-50 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
            >
              Abandoned form
            </Badge>
          )}
        </div>
      ),
      filterFn: () => true,
    },
    {
      id: "note",
      meta: { label: "Note" },
      header: "Note",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex max-w-[240px] flex-col gap-0.5 whitespace-normal break-words">
          <span className="text-xs text-muted-foreground">
            Updated {timeAgo(row.original.updatedAt)}
          </span>
          <span className="line-clamp-2 text-sm">
            {row.original.comment || "-"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "address",
      meta: { label: "Address" },
      header: "Address",
      cell: ({ row }) => (
        <span className="line-clamp-3 max-w-[220px] whitespace-normal break-words text-sm text-muted-foreground">
          {row.original.address}
        </span>
      ),
    },
    {
      id: "fraud",
      meta: { label: "Success Rate" },
      header: ({ column }) => (
        <SortableHeader
          label="Success Rate"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      accessorFn: (row) => row.fraud?.successRate ?? -1,
      cell: ({ row }) => <FraudBadge fraud={row.original.fraud} />,
    },
    {
      id: "tags",
      meta: { label: "Tags" },
      header: "Tags",
      enableSorting: false,
      cell: ({ row }) => (
        <OrderTags order={row.original} onOrderUpdated={onOrderUpdated} />
      ),
    },
    {
      id: "source",
      header: "Source",
      enableSorting: false,
      meta: { label: "Source" },
      // The Source filter is answered by the API (the lists are server-side),
      // so the row never needs deciding here — same as the status column.
      filterFn: () => true,
      cell: ({ row }) => (
        <Badge
          className={cn(
            "border-transparent",
            SOURCE_BADGE_CLASS[row.original.source]
          )}
        >
          {ORDER_SOURCE_LABELS[row.original.source]}
        </Badge>
      ),
    },
    {
      id: "staff",
      header: "Staff",
      enableSorting: false,
      meta: { label: "Staff" },
      cell: ({ row }) =>
        row.original.staffName ? (
          // The nickname if one is set, otherwise a trimmed full name. The
          // full name stays on hover either way.
          <span title={row.original.staffName}>
            {staffLabel(row.original.staffName, row.original.staffNickname)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "printed",
      header: "Print",
      enableSorting: false,
      meta: { label: "Print" },
      cell: ({ row }) => <FlagCell on={row.original.printed} />,
    },
    {
      id: "courier",
      header: "Courier",
      enableSorting: false,
      meta: { label: "Courier" },
      cell: ({ row }) => <FlagCell on={row.original.courier} />,
    },
    {
      id: "pathao",
      header: "Pathao",
      enableSorting: false,
      meta: { label: "Pathao" },
      cell: ({ row }) => <PathaoCell order={row.original} />,
    },
    {
      id: "delivery",
      header: "Delivery",
      enableSorting: false,
      meta: { label: "Delivery" },
      cell: ({ row }) => <DeliveryCell order={row.original} />,
    },
    {
      id: "status",
      header: () => null,
      cell: () => null,
      enableSorting: false,
      enableHiding: false,
      filterFn: () => true,
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const claim = activeClaim(row.original);
        const mine = claim?.id === currentUserId;
        if (claim && !mine) {
          // Someone else has the modal open: say who, and keep it closed.
          return (
            <span
              title={`${claim.fullName} is working on this order`}
              className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              <Lock className="size-3" />
              {claim.label}
            </span>
          );
        }
        return (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpen(row.original)}
          >
            {mine ? "Resume" : "Open"}
            <ExternalLink className="ml-1 size-3.5" />
          </Button>
        );
      },
    },
  ];
}
