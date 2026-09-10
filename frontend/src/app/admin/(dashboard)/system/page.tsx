"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Globe,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/components/admin/auth-context";
import { MinuteBars } from "@/components/admin/system/minute-bars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getSystemOverview,
  resendFailedCapiEvents,
  type SystemOverview,
} from "@/lib/api";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/orders";
import { cn } from "@/lib/utils";

const REFRESH_MS = 10_000;

function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "good" | "warning" | "critical";
}) {
  const toneClass = {
    neutral: "text-muted-foreground",
    good: "text-[#0ca30c]",
    warning: "text-[#b97f00] dark:text-[#fab219]",
    critical: "text-[#d03b3b]",
  }[tone];
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl font-semibold tabular-nums">
          {value}
        </CardTitle>
        {detail && (
          <p className="text-xs text-muted-foreground">{detail}</p>
        )}
        <CardAction>
          <Icon className={cn("size-4", toneClass)} />
        </CardAction>
      </CardHeader>
    </Card>
  );
}

/** A meter for a share of capacity: neutral until it's worth attention. */
function Meter({
  label,
  used,
  total,
  detail,
}: {
  label: string;
  used: number;
  total: number;
  detail: string;
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const tone = pct >= 90 ? "critical" : pct >= 75 ? "warning" : "neutral";
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {label}
          {tone !== "neutral" && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                tone === "critical"
                  ? "text-[#d03b3b]"
                  : "text-[#b97f00] dark:text-[#fab219]"
              )}
            >
              <AlertTriangle className="size-3" />
              {tone === "critical" ? "Critical" : "High"}
            </span>
          )}
        </CardDescription>
        <CardTitle className="text-xl font-semibold tabular-nums">
          {pct.toFixed(0)}%
        </CardTitle>
        <p className="text-xs text-muted-foreground">{detail}</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-table-header">
          <div
            className={cn(
              "h-full rounded-full",
              tone === "critical"
                ? "bg-[#d03b3b]"
                : tone === "warning"
                  ? "bg-[#fab219]"
                  : "bg-foreground/50"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>
    </Card>
  );
}

function TrafficChart({
  title,
  icon: Icon,
  total,
  points,
  fillClass,
  unit,
  tone,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  total: number;
  points: { minute: string; value: number }[];
  fillClass: string;
  unit: string;
  tone?: "warning" | "critical";
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon
            className={cn(
              "size-3.5",
              tone === "critical" && "text-[#d03b3b]",
              tone === "warning" && "text-[#b97f00] dark:text-[#fab219]"
            )}
          />
          {title}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {total.toLocaleString()}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            last hour
          </span>
        </CardTitle>
        <div className="mt-2">
          <MinuteBars points={points} fillClass={fillClass} label={unit} />
        </div>
      </CardHeader>
    </Card>
  );
}

export default function SystemPage() {
  const { user } = useAuth();
  const [data, setData] = React.useState<SystemOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadedAt, setLoadedAt] = React.useState<number | null>(null);
  // Seeded from the effect, never during render, so the component stays pure.
  const [now, setNow] = React.useState<number | null>(null);
  const [showTable, setShowTable] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setData(await getSystemOverview());
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  // Parked Conversions API events: one resend attempt each, then reload.
  const [resending, setResending] = React.useState(false);
  const [resendNote, setResendNote] = React.useState<string | null>(null);
  const resend = React.useCallback(async () => {
    setResending(true);
    setResendNote(null);
    try {
      const r = await resendFailedCapiEvents();
      setResendNote(
        `${r.sent} sent, ${r.failed} still failing, ${r.remaining} parked`
      );
      await load();
    } catch (err) {
      setResendNote(err instanceof Error ? err.message : "Resend failed");
    } finally {
      setResending(false);
    }
  }, [load]);

  React.useEffect(() => {
    if (user.role !== "super_admin") return;
    load();
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, user.role]);

  if (user.role !== "super_admin") {
    return (
      <p className="text-sm text-muted-foreground">
        This page is for super admins only.
      </p>
    );
  }

  const ago =
    loadedAt !== null && now !== null
      ? Math.max(0, Math.round((now - loadedAt) / 1000))
      : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Live view of the API, database, traffic and protection. Refreshes
          every {REFRESH_MS / 1000}s while this tab is open
          {ago !== null && <> · updated {ago}s ago</>}.
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <Section title="Health">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <Tile
                label="API"
                value={`Up · ${duration(data.process.uptime_seconds)}`}
                detail={`${data.process.workers_configured} workers · Python ${data.process.python}`}
                icon={CheckCircle2}
                tone="good"
              />
              <Tile
                label="Database"
                value={
                  data.database.ok
                    ? `OK · ${data.database.latency_ms} ms`
                    : "Unreachable"
                }
                detail={`${bytes(data.database.size_bytes)} · PostgreSQL ${data.database.version} · pool ${data.database.pool.in_use}/${data.database.pool.size}${data.database.pool.overflow ? ` +${data.database.pool.overflow}` : ""}`}
                icon={Database}
                tone={data.database.ok ? "good" : "critical"}
              />
              <Tile
                label="Client address header"
                value={
                  data.request.client_ip_visible
                    ? `Visible · ${data.request.client_ip}`
                    : "Not visible"
                }
                detail={
                  data.request.client_ip_visible
                    ? `${data.request.client_ip_header_present ? `From ${data.request.client_ip_header}` : "From socket address"}${data.request.via_cloudflare ? " · via Cloudflare" : ""}${data.request.country ? ` · ${data.request.country}` : ""}`
                    : data.request.client_ip_header
                      ? `Per-IP limiting is off: ${data.request.client_ip_header} is not reaching the API`
                      : "Per-IP limiting is off: no public client address is reaching the API"
                }
                icon={data.request.client_ip_visible ? ShieldCheck : ShieldAlert}
                tone={data.request.client_ip_visible ? "good" : "critical"}
              />
              <Tile
                label="Meta tracking"
                value={
                  <span className="flex flex-wrap gap-1.5 text-sm">
                    {/* The selected store's pixel, from its Settings. */}
                    <Badge variant={data.integrations.meta_pixel ? "default" : "outline"}>
                      Browser pixel {data.integrations.meta_pixel ? "on" : "off"}
                    </Badge>
                    <Badge variant={data.integrations.meta_capi ? "default" : "outline"}>
                      Server CAPI {data.integrations.meta_capi ? "on" : "off"}
                      {data.integrations.meta_test_mode ? " (test)" : ""}
                    </Badge>
                    {data.integrations.meta_capi_failed > 0 && (
                      <Badge variant="destructive">
                        {data.integrations.meta_capi_failed} failed
                      </Badge>
                    )}
                  </span>
                }
                detail={
                  data.integrations.meta_pixel && !data.integrations.meta_capi ? (
                    "Server-side events start once the CAPI access token is set in Settings"
                  ) : data.integrations.meta_capi_failed > 0 ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {data.integrations.meta_capi_failed} server event
                      {data.integrations.meta_capi_failed === 1 ? "" : "s"} Meta never
                      accepted (after retries) — parked, not lost.
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={resending}
                        onClick={resend}
                      >
                        <RefreshCw className={cn("size-3", resending && "animate-spin")} />
                        Resend
                      </Button>
                      {resendNote && <span>{resendNote}</span>}
                    </span>
                  ) : data.integrations.meta_capi ? (
                    `Browser and server events both sending${
                      data.integrations.meta_test_mode
                        ? " — to Test Events only: clear the test event code in Settings before going live"
                        : ""
                    }${
                      data.integrations.meta_capi_pending
                        ? ` · ${data.integrations.meta_capi_pending} in flight`
                        : ""
                    }`
                  ) : (
                    "No pixel configured for this store (Settings → Meta)"
                  )
                }
                icon={Globe}
                tone={
                  data.integrations.meta_capi_failed > 0 || data.integrations.meta_test_mode
                    ? "warning"
                    : data.integrations.meta_pixel
                      ? "good"
                      : "neutral"
                }
              />
              <Tile
                label="Sign-in & cookies"
                value={
                  <span className="flex flex-wrap gap-1.5 text-sm">
                    <Badge variant={data.integrations.google_login ? "default" : "outline"}>
                      Google login {data.integrations.google_login ? "on" : "off"}
                    </Badge>
                    <Badge variant={data.integrations.secure_cookies ? "default" : "outline"}>
                      Secure cookies {data.integrations.secure_cookies ? "on" : "off"}
                    </Badge>
                  </span>
                }
                detail={
                  data.integrations.secure_cookies
                    ? "Session cookie is HTTPS-only"
                    : "COOKIE_SECURE=false: fine for the localhost tunnel, set true if admin is only ever used over HTTPS"
                }
                icon={ShieldCheck}
                tone={data.integrations.secure_cookies ? "good" : "neutral"}
              />
            </div>
          </Section>

          <Section
            title="Traffic"
            description={`Every request to the API, summed across workers; counters land every ${data.traffic.flush_every_seconds}s.`}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTable((v) => !v)}
              >
                {showTable ? "Show charts" : "Show table"}
              </Button>
            }
          >
            {showTable ? (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Minute</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">429</TableHead>
                      <TableHead className="text-right">409</TableHead>
                      <TableHead className="text-right">4xx</TableHead>
                      <TableHead className="text-right">5xx</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...data.traffic.per_minute].reverse().map((p) => (
                      <TableRow key={p.minute}>
                        <TableCell>
                          {new Date(p.minute).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.requests}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.throttled}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.cooldown}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.client_errors}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.server_errors}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                <TrafficChart
                  title="Requests"
                  icon={Activity}
                  total={data.traffic.last_hour.requests}
                  points={data.traffic.per_minute.map((p) => ({ minute: p.minute, value: p.requests }))}
                  fillClass="fill-[#2a78d6] dark:fill-[#3987e5]"
                  unit="requests"
                />
                <TrafficChart
                  title="Throttled (429)"
                  icon={ShieldAlert}
                  tone="warning"
                  total={data.traffic.last_hour.throttled}
                  points={data.traffic.per_minute.map((p) => ({ minute: p.minute, value: p.throttled }))}
                  fillClass="fill-[#fab219]"
                  unit="throttled"
                />
                <TrafficChart
                  title="Server errors (5xx)"
                  icon={XCircle}
                  tone="critical"
                  total={data.traffic.last_hour.server_errors}
                  points={data.traffic.per_minute.map((p) => ({ minute: p.minute, value: p.server_errors }))}
                  fillClass="fill-[#d03b3b]"
                  unit="errors"
                />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Tile label="Requests · 24h" value={data.traffic.last_24h.requests.toLocaleString()} icon={Activity} />
              <Tile label="Avg latency · 24h" value={`${data.traffic.last_24h.avg_latency_ms} ms`} icon={Activity} />
              <Tile label="Cooldown refusals (409) · 24h" value={data.traffic.last_24h.cooldown.toLocaleString()} icon={ShieldCheck} />
              <Tile label="Client errors (4xx) · 24h" value={data.traffic.last_24h.client_errors.toLocaleString()} icon={Activity} />
              <Tile
                label="Server errors (5xx) · 24h"
                value={data.traffic.last_24h.server_errors.toLocaleString()}
                icon={XCircle}
                tone={data.traffic.last_24h.server_errors ? "critical" : "neutral"}
              />
            </div>
          </Section>

          <Section
            title="Visitors"
            description={
              data.visitors.since
                ? `Distinct browsers on the storefront, and how many of them ordered. Counting since ${new Date(data.visitors.since).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}; Dhaka days.`
                : "Distinct browsers on the storefront, and how many of them ordered. Nothing counted yet — the first storefront page view starts it."
            }
          >
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Window</TableHead>
                      <TableHead className="text-right">Visitors</TableHead>
                      <TableHead className="text-right">Page views</TableHead>
                      <TableHead className="text-right">Web orders</TableHead>
                      <TableHead className="text-right">Conversion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.visitors.periods.map((p) => (
                      <TableRow key={p.key}>
                        <TableCell className="font-medium">{p.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.visitors.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.page_views.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.orders.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.conversion_pct === null ? "—" : `${p.conversion_pct.toFixed(1)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Tile
                label="Conversion today"
                value={
                  data.visitors.periods[0]?.conversion_pct == null
                    ? "—"
                    : `${data.visitors.periods[0].conversion_pct.toFixed(1)}%`
                }
                detail={`${data.visitors.periods[0]?.orders ?? 0} web order${
                  data.visitors.periods[0]?.orders === 1 ? "" : "s"
                } from ${data.visitors.periods[0]?.visitors ?? 0} visitor${
                  data.visitors.periods[0]?.visitors === 1 ? "" : "s"
                }. A visitor is one browser (its _fbp cookie); orders typed in by staff are not counted.`}
                icon={Users}
              />
            </div>
          </Section>

          <Section title="Orders" description="From the audit trail, so a form that later became an order counts once in each column.">
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Window</TableHead>
                      <TableHead className="text-right">Orders placed</TableHead>
                      <TableHead className="text-right">Forms captured</TableHead>
                      <TableHead className="text-right">Confirmed</TableHead>
                      <TableHead className="text-right">Cancelled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(["last_hour", "last_24h"] as const).map((w) => (
                      <TableRow key={w}>
                        <TableCell className="font-medium">{w === "last_hour" ? "Last hour" : "Last 24h"}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.orders.flow[w].orders_placed}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.orders.flow[w].forms_captured}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.orders.flow[w].confirmed}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.orders.flow[w].cancelled}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Card>
                <CardHeader>
                  <CardDescription>In the system now</CardDescription>
                  <CardTitle className="text-xl font-semibold tabular-nums">
                    {data.orders.total.toLocaleString()} orders
                  </CardTitle>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(data.orders.by_status).map(([status, count]) => (
                      <Badge key={status} variant="secondary" className="tabular-nums">
                        {ORDER_STATUS_LABELS[status as OrderStatus] ?? status} {count}
                      </Badge>
                    ))}
                  </div>
                  {data.orders.pending_signins > 0 && (
                    <p className="mt-2 text-xs">
                      <AlertTriangle className="mr-1 inline size-3 text-[#b97f00] dark:text-[#fab219]" />
                      {data.orders.pending_signins} sign-in request
                      {data.orders.pending_signins === 1 ? "" : "s"} waiting —{" "}
                      <Link href="/admin/users" className="underline underline-offset-2">
                        review
                      </Link>
                    </p>
                  )}
                </CardHeader>
              </Card>
            </div>
          </Section>

          <Section
            title="Rate limiting"
            description={`Per IP, per ${data.rate_limits.limiters[0]?.window_seconds / 60} minutes. Tracked and blocked counts are this worker's view (${data.process.worker}); the 429 chart above is the whole service.`}
          >
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="text-right">Limit</TableHead>
                    <TableHead className="text-right">Tracked IPs</TableHead>
                    <TableHead className="text-right">Blocked now</TableHead>
                    <TableHead>Blocked addresses</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rate_limits.limiters.map((l) => (
                    <TableRow key={l.name}>
                      <TableCell className="font-medium capitalize">{l.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.limit}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.tracked_ips}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", l.blocked_now > 0 && "font-semibold text-[#d03b3b]")}>
                        {l.blocked_now}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {l.blocked_ips.length ? l.blocked_ips.join(", ") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              One order per phone number per {data.rate_limits.order_cooldown_hours}h.
              {data.rate_limits.limiters.some((l) => l.seen_blind_requests) && (
                <span className="ml-1 text-[#b97f00] dark:text-[#fab219]">
                  <AlertTriangle className="mr-1 inline size-3" />
                  Some requests since startup arrived without a client address and were not limited.
                </span>
              )}
            </p>
          </Section>

          <Section title="Server" description="The whole machine, not just the API container.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Meter
                label="CPU load (1 min)"
                used={data.server.load[0]}
                total={data.server.cpus}
                detail={`${data.server.load.join(" / ")} over ${data.server.cpus} CPUs`}
              />
              <Meter
                label="Memory"
                used={(data.server.memory_total ?? 0) - (data.server.memory_available ?? 0)}
                total={data.server.memory_total ?? 0}
                detail={`${bytes((data.server.memory_total ?? 0) - (data.server.memory_available ?? 0))} of ${bytes(data.server.memory_total)} in use`}
              />
              <Meter
                label="Disk"
                used={data.server.disk_total - data.server.disk_free}
                total={data.server.disk_total}
                detail={`${bytes(data.server.disk_free)} free of ${bytes(data.server.disk_total)}`}
              />
            </div>
          </Section>

          <Section
            title="Recent warnings & errors"
            description="Rate-limit blocks, Meta CAPI failures and crashes, newest first. Kept in memory since the API started."
          >
            {data.recent_logs.length === 0 ? (
              <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing logged since the API started {duration(data.process.uptime_seconds)} ago.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent_logs.map((entry, i) => (
                      <TableRow key={`${entry.time}-${i}`}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(entry.time).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              "border-transparent",
                              entry.level === "ERROR" || entry.level === "CRITICAL"
                                ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            )}
                          >
                            {entry.level}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{entry.logger}</TableCell>
                        <TableCell className="max-w-[640px] whitespace-normal break-words">{entry.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <p className="text-xs text-muted-foreground">
            <Server className="mr-1 inline size-3" />
            Served by worker {data.process.worker}, up since{" "}
            {new Date(data.process.started_at).toLocaleString("en-GB")}.
          </p>
        </>
      )}
    </div>
  );
}
