import { COURIER_LABELS, type CourierName } from "@/lib/orders";
import { cn } from "@/lib/utils";

// One colour per courier, so a list mixing both reads at a glance.
const COURIER_CLASS: Record<CourierName, string> = {
  pathao: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  carrybee: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};

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
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none",
        COURIER_CLASS[name],
        className
      )}
    >
      {COURIER_LABELS[name]}
    </span>
  );
}
