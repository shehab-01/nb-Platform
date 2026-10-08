"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  connectDrive,
  disconnectDrive,
  getDriveStatus,
  type DriveStatus,
} from "@/lib/api";

/**
 * The platform's Google Drive, where expense proofs are kept. Connect sends
 * the super admin to Google's consent page; Google brings them back here with
 * ?drive=connected or ?drive_error=…, which this card reads once and clears.
 */
export function DriveCard() {
  const [status, setStatus] = React.useState<DriveStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);

  const load = React.useCallback(() => {
    getDriveStatus()
      .then(setStatus)
      .catch((err) =>
        setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed to load" })
      );
  }, []);

  React.useEffect(() => {
    // What Google's round trip came back with, once.
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "connected") {
      setNotice({ ok: true, text: "Google Drive connected." });
    } else if (params.get("drive_error")) {
      setNotice({ ok: false, text: params.get("drive_error") ?? "Could not connect" });
    }
    if (params.has("drive") || params.has("drive_error")) {
      params.delete("drive");
      params.delete("drive_error");
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
    load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      window.location.assign(await connectDrive());
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not start" });
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectDrive();
      setNotice({ ok: true, text: "Disconnected. Files already in Drive stay there." });
      load();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not disconnect" });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4 text-muted-foreground" />
          Google Drive
        </CardTitle>
        <CardDescription>
          Where expense proofs are kept: {status?.root_folder ?? "nbPlatform"} / store /
          Expenses / date. Files stay private; the admin shows them to people with
          CRM access only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice && (
          <div
            className={
              notice.ok
                ? "flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            }
          >
            {notice.ok ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <CircleAlert className="size-4 shrink-0" />
            )}
            {notice.text}
          </div>
        )}

        {!status ? (
          <Skeleton className="h-10 w-full" />
        ) : !status.configured ? (
          <p className="text-sm text-muted-foreground">
            Not set up on this server: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and
            GOOGLE_DRIVE_REDIRECT_URI must be set (see .env.example).
          </p>
        ) : status.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="flex items-center gap-1.5 font-medium">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
                Connected{status.account_email ? ` as ${status.account_email}` : ""}
              </div>
              {status.connected_at && (
                <div className="text-xs text-muted-foreground">
                  Since{" "}
                  {new Date(status.connected_at).toLocaleString("en-GB", {
                    timeZone: "Asia/Dhaka",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={connect}>
                Reconnect
              </Button>
              {confirming ? (
                <Button variant="destructive" size="sm" disabled={busy} onClick={disconnect}>
                  Disconnect — sure?
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                  Disconnect
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Not connected. Proofs cannot be uploaded until it is.
            </p>
            <Button size="sm" disabled={busy} onClick={connect}>
              {busy ? "Opening Google…" : "Connect Google Drive"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
