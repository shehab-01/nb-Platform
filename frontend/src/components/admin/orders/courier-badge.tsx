import { COURIER_LABELS, type CourierName } from "@/lib/orders";
import { cn } from "@/lib/utils";

// One colour per courier, so a list mixing both reads at a glance.
const COURIER_CLASS: Record<CourierName, string> = {
  pathao: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  carrybee: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};

const BADGE = "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none";

/** A small tag naming the courier a parcel is booked with. */
export function CourierBadge({
  courier,
  className,
}: {
  courier: CourierName | null;
  className?: string;
}) {
  const name = courier ?? "pathao";
  return (
    <span className={cn(BADGE, COURIER_CLASS[name], className)}>
      {COURIER_LABELS[name]}
    </span>
  );
}

// Couriers first, in a fixed order, then the orders not sent yet.
const COUNT_ORDER: (CourierName | "none")[] = ["pathao", "carrybee", "none"];

/**
 * A figure split by where the parcels went: one badge and count per courier,
 * plus "Not sent" for orders no courier has yet. Zero shares are left out.
 */
export function CourierCounts({
  counts,
  className,
}: {
  counts: Partial<Record<CourierName | "none", number>> | undefined;
  className?: string;
}) {
  const shown = COUNT_ORDER.filter((key) => (counts?.[key] ?? 0) > 0);
  if (!counts || shown.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {shown.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          {key === "none" ? (
            <span className={cn(BADGE, "bg-muted text-muted-foreground")}>Not sent</span>
          ) : (
            <CourierBadge courier={key} />
          )}
          <span className="font-medium tabular-nums text-foreground">
            {(counts[key] ?? 0).toLocaleString()}
          </span>
        </span>
      ))}
    </span>
  );
}
