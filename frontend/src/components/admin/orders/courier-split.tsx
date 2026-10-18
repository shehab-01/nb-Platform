import { CourierBadge } from "@/components/admin/orders/courier-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CourierSplit } from "@/lib/api";

const n = (value: number) => value.toLocaleString();

/**
 * A period's parcels by courier: how many each one took, delivered, returned
 * and still has. One row per courier that has any parcels in the period.
 */
export function CourierSplitCard({
  title,
  description,
  splits,
}: {
  title: string;
  description?: string;
  /** undefined while loading. */
  splits: CourierSplit[] | undefined;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {splits === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : splits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parcels sent to a courier yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-80 text-sm tabular-nums">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Courier</th>
                  <th className="py-2 pr-3 text-right font-medium">Sent</th>
                  <th className="py-2 pr-3 text-right font-medium">Delivered</th>
                  <th className="py-2 pr-3 text-right font-medium">Returned</th>
                  <th className="py-2 text-right font-medium">In transit</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {splits.map((s) => (
                  <tr key={s.courier}>
                    <td className="py-2 pr-3">
                      <CourierBadge courier={s.courier} />
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold">{n(s.sent)}</td>
                    <td className="py-2 pr-3 text-right text-emerald-700 dark:text-emerald-400">
                      {n(s.delivered)}
                    </td>
                    <td className="py-2 pr-3 text-right">{n(s.returned)}</td>
                    <td className="py-2 text-right text-sky-700 dark:text-sky-400">
                      {n(s.in_transit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
