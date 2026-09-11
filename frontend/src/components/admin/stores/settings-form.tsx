"use client";

import * as React from "react";

import { SecretInput } from "@/components/admin/stores/secret-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { testPathao, type PathaoTest, type StoreSettings, type StoreSettingsInput } from "@/lib/api";

type ItemType = StoreSettings["pathaoItemType"];

type Draft = {
  metaPixelId: string;
  metaCapiToken?: string;
  metaTestEventCode: string;
  pathaoClientId: string;
  pathaoClientSecret?: string;
  pathaoEmail: string;
  pathaoPassword?: string;
  pathaoStoreId: string;
  pathaoItemType: ItemType;
  pathaoParcelWeightKg: string;
  bdcourierApiKey?: string;
};

function draftFrom(settings: StoreSettings): Draft {
  return {
    metaPixelId: settings.metaPixelId,
    metaTestEventCode: settings.metaTestEventCode,
    pathaoClientId: settings.pathaoClientId,
    pathaoEmail: settings.pathaoEmail,
    pathaoStoreId: settings.pathaoStoreId != null ? String(settings.pathaoStoreId) : "",
    pathaoItemType: settings.pathaoItemType,
    pathaoParcelWeightKg: settings.pathaoParcelWeightKg,
  };
}

/** The store's integrations: Meta, Pathao, BDCourier. Secrets are write-only. */
export function SettingsForm({
  storeId,
  settings,
  onSave,
}: {
  storeId: number;
  settings: StoreSettings;
  onSave: (input: StoreSettingsInput) => Promise<StoreSettings>;
}) {
  const [current, setCurrent] = React.useState(settings);
  const [d, setD] = React.useState<Draft>(() => draftFrom(settings));
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [test, setTest] = React.useState<PathaoTest | null>(null);
  // Edits since the last save: the test runs against saved credentials only.
  const [dirty, setDirty] = React.useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const discard = () => {
    setD(draftFrom(current));
    setDirty(false);
    setStatus(null);
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await testPathao(storeId));
    } catch (err) {
      setTest({
        enabled: false,
        sandbox: true,
        baseUrl: "",
        storeId: 0,
        stores: [],
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const weight = Number(d.pathaoParcelWeightKg);
  const valid = weight >= 0.5 && weight <= 10 && (d.pathaoStoreId === "" || /^\d+$/.test(d.pathaoStoreId));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const saved = await onSave({
        metaPixelId: d.metaPixelId.trim(),
        metaCapiToken: d.metaCapiToken,
        metaTestEventCode: d.metaTestEventCode.trim(),
        pathaoClientId: d.pathaoClientId.trim(),
        pathaoClientSecret: d.pathaoClientSecret,
        pathaoEmail: d.pathaoEmail.trim(),
        pathaoPassword: d.pathaoPassword,
        pathaoStoreId: d.pathaoStoreId === "" ? null : Number(d.pathaoStoreId),
        pathaoItemType: d.pathaoItemType,
        pathaoParcelWeightKg: d.pathaoParcelWeightKg,
        bdcourierApiKey: d.bdcourierApiKey,
      });
      setCurrent(saved);
      // Secrets were written (or cleared); the boxes go back to "keep".
      setD((prev) => ({
        ...prev,
        metaCapiToken: undefined,
        pathaoClientSecret: undefined,
        pathaoPassword: undefined,
        bdcourierApiKey: undefined,
      }));
      setStatus({ ok: true, text: "Saved" });
      setDirty(false);
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  };

  const metaStatus: SectionStatus = current.metaPixelId || current.metaCapiTokenSet
    ? { label: "Connected", tone: "good" }
    : { label: "Not set", tone: "neutral" };
  const pathaoStatus: SectionStatus = test
    ? test.error
      ? { label: "Connection failed", tone: "warning" }
      : { label: "Connected", tone: "good" }
    : current.pathaoClientId && current.pathaoEmail
      ? { label: "Not verified", tone: "warning" }
      : { label: "Not set", tone: "neutral" };
  const bdcourierStatus: SectionStatus = current.bdcourierApiKeySet
    ? { label: "Connected", tone: "good" }
    : { label: "Not set", tone: "neutral" };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Section title="Meta" note="Pixel and conversions API" status={metaStatus}>
        <Field label="Pixel ID" htmlFor="pixel">
          <Input id="pixel" maxLength={40} value={d.metaPixelId} onChange={(e) => set("metaPixelId", e.target.value)} />
        </Field>
        <Field label="CAPI access token" htmlFor="capi">
          <SecretInput id="capi" isSet={current.metaCapiTokenSet} hint={current.metaCapiTokenHint} value={d.metaCapiToken} onChange={(v) => set("metaCapiToken", v)} />
        </Field>
        <Field label="Test event code" htmlFor="testcode">
          <Input id="testcode" maxLength={40} placeholder="TEST12345" value={d.metaTestEventCode} onChange={(e) => set("metaTestEventCode", e.target.value)} />
        </Field>
      </Section>

      <Section title="Pathao" note="Courier credentials" status={pathaoStatus}>
        <Field label="Client ID" htmlFor="p-client">
          <Input id="p-client" maxLength={120} value={d.pathaoClientId} onChange={(e) => set("pathaoClientId", e.target.value)} />
        </Field>
        <Field label="Client secret" htmlFor="p-secret">
          <SecretInput id="p-secret" isSet={current.pathaoClientSecretSet} hint={current.pathaoClientSecretHint} value={d.pathaoClientSecret} onChange={(v) => set("pathaoClientSecret", v)} />
        </Field>
        <Field label="Client email" htmlFor="p-email">
          <Input id="p-email" type="email" maxLength={255} value={d.pathaoEmail} onChange={(e) => set("pathaoEmail", e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="p-pass">
          <SecretInput id="p-pass" isSet={current.pathaoPasswordSet} hint={null} value={d.pathaoPassword} onChange={(v) => set("pathaoPassword", v)} />
        </Field>
        <Field label="Store ID" htmlFor="p-store">
          <Input id="p-store" inputMode="numeric" value={d.pathaoStoreId} onChange={(e) => set("pathaoStoreId", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Item type">
          <Select value={d.pathaoItemType} onValueChange={(v) => set("pathaoItemType", v as ItemType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="parcel">Parcel</SelectItem>
              <SelectItem value="document">Document</SelectItem>
              <SelectItem value="fragile">Fragile</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Parcel weight (kg)" htmlFor="p-weight">
          <Input id="p-weight" type="number" step="0.5" min={0.5} max={10} value={d.pathaoParcelWeightKg} onChange={(e) => set("pathaoParcelWeightKg", e.target.value)} />
        </Field>
        <Field label="">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={testing} onClick={runTest}>
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {dirty ? "Save first: the test uses saved credentials." : "Logs in to Pathao with the saved credentials."}
              </span>
            </div>
            {test && (
              <div className="rounded-lg border p-3 text-sm">
                {test.error ? (
                  <p className="text-destructive">{test.error}</p>
                ) : (
                  <p className="text-muted-foreground">
                    Connected to Pathao {test.sandbox ? "sandbox" : "live"}.
                    {test.stores.length > 0
                      ? " Merchant stores on this account:"
                      : " The account has no merchant stores yet."}
                  </p>
                )}
                {test.stores.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {test.stores.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3">
                        <span>
                          <span className="font-medium">{s.name}</span>{" "}
                          <span className="text-muted-foreground">#{s.id}</span>
                          {s.address && <span className="text-muted-foreground"> · {s.address}</span>}
                        </span>
                        {String(s.id) === d.pathaoStoreId ? (
                          <span className="text-xs text-muted-foreground">selected</span>
                        ) : (
                          <Button type="button" variant="ghost" size="sm" onClick={() => set("pathaoStoreId", String(s.id))}>
                            Use this id
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Field>
      </Section>

      <Section title="BDCourier" note="Delivery ratio lookup" status={bdcourierStatus}>
        <Field label="API key" htmlFor="fraud">
          <SecretInput id="fraud" isSet={current.bdcourierApiKeySet} hint={current.bdcourierApiKeyHint} value={d.bdcourierApiKey} onChange={(v) => set("bdcourierApiKey", v)} />
        </Field>
      </Section>

      {!current.encryptionAvailable && (
        <p className="text-sm text-destructive">APP_ENCRYPTION_KEY is not set on the server: secrets cannot be saved.</p>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background/95 py-4 backdrop-blur-sm">
        <Button type="submit" disabled={busy || !valid}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy || !dirty} onClick={discard}>
          Discard
        </Button>
        <p
          className={cn(
            "ml-auto text-xs",
            status ? (status.ok ? "text-muted-foreground" : "text-destructive") : "text-muted-foreground"
          )}
        >
          {status ? status.text : dirty ? "Unsaved changes" : "All changes saved"}
        </p>
      </div>
    </form>
  );
}

type SectionStatus = { label: string; tone: "good" | "warning" | "neutral" };

const TONE_CLASS: Record<SectionStatus["tone"], string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  neutral: "bg-muted text-muted-foreground",
};

function Section({
  title,
  note,
  status,
  children,
}: {
  title: string;
  note?: string;
  status?: SectionStatus;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {status && <Badge className={cn("border-transparent", TONE_CLASS[status.tone])}>{status.label}</Badge>}
      </div>
      <div className="flex flex-col px-5">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-1.5 border-b border-border/70 py-3.5 last:border-b-0 sm:grid-cols-[160px_1fr] sm:gap-4">
      <Label htmlFor={htmlFor} className="text-sm">{label}</Label>
      <div>{children}</div>
    </div>
  );
}
