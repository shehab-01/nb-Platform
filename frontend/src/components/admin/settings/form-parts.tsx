"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** The pieces the Settings pages (Store, Courier) are built from. */

export type SectionStatus = { label: string; tone: "good" | "warning" | "neutral" };

const TONE_CLASS: Record<SectionStatus["tone"], string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  neutral: "bg-muted text-muted-foreground",
};

export function Section({
  title,
  note,
  status,
  toggle,
  actions,
  children,
}: {
  title: string;
  note?: string;
  status?: SectionStatus;
  /** A switch in the header; while off, the body folds away. */
  toggle?: { checked: boolean; onChange: (on: boolean) => void; label: string };
  /** Buttons at the right of the header. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const open = toggle ? toggle.checked : true;
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 bg-muted/30 px-5 py-3.5",
          open && "border-b"
        )}
      >
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        <div className="flex items-center gap-3">
          {status && <Badge className={cn("border-transparent", TONE_CLASS[status.tone])}>{status.label}</Badge>}
          {actions}
          {toggle && (
            <Switch checked={toggle.checked} onCheckedChange={toggle.onChange} aria-label={toggle.label} />
          )}
        </div>
      </div>
      {open && <div className="flex flex-col px-5">{children}</div>}
    </section>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-1.5 border-b border-border/70 py-3.5 last:border-b-0 sm:grid-cols-[160px_1fr] sm:gap-4">
      <Label htmlFor={htmlFor} className="text-sm">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-7 shrink-0"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

/** A URL or value shown in full, with a copy button. */
export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">{value}</code>
      <CopyButton text={value} />
    </div>
  );
}

/** A webhook secret to paste into a courier's panel: long, random, URL-safe. */
export function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const noSubscribe = () => () => {};

/** The admin's own origin: the couriers post to it, and the /api rewrite
 *  takes the call to the API. Empty while server-rendering. */
export function useOrigin(): string {
  return React.useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => ""
  );
}
