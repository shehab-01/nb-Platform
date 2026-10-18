"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  testCarrybee,
  testPathao,
  type CarrybeeProductType,
  type CarrybeeTest,
  type PathaoTest,
  type StoreSettings,
  type StoreSettingsInput,
} from "@/lib/api";

type ItemType = StoreSettings["pathaoItemType"];

type Draft = {
  metaPixelId: string;
  metaCapiToken?: string;
  metaTestEventCode: string;
  pathaoEnabled: boolean;
  pathaoClientId: string;
  pathaoClientSecret?: string;
  pathaoEmail: string;
  pathaoPassword?: string;
  pathaoStoreId: string;
  pathaoItemType: ItemType;
  pathaoParcelWeightKg: string;
  carrybeeEnabled: boolean;
  carrybeeClientId: string;
  carrybeeClientSecret?: string;
  carrybeeClientContext?: string;
  carrybeeStoreId: string;
  carrybeeProductType: CarrybeeProductType;
  carrybeeItemWeightG: string;
  carrybeeWebhookSecret?: string;
  carrybeeIntegrationHeader: string;
  bdcourierApiKey?: string;
};

function draftFrom(settings: StoreSettings): Draft {
  return {
    metaPixelId: settings.metaPixelId,
    metaTestEventCode: settings.metaTestEventCode,
    pathaoEnabled: settings.pathaoEnabled,
    pathaoClientId: settings.pathaoClientId,
    pathaoEmail: settings.pathaoEmail,
    pathaoStoreId: settings.pathaoStoreId != null ? String(settings.pathaoStoreId) : "",
    pathaoItemType: settings.pathaoItemType,
    pathaoParcelWeightKg: settings.pathaoParcelWeightKg,
    carrybeeEnabled: settings.carrybeeEnabled,
    carrybeeClientId: settings.carrybeeClientId,
    carrybeeStoreId: settings.carrybeeStoreId,
    carrybeeProductType: settings.carrybeeProductType,
    carrybeeItemWeightG: String(settings.carrybeeItemWeightG),
    carrybeeIntegrationHeader: settings.carrybeeIntegrationHeader,
  };
}

const noSubscribe = () => () => {};

/** A webhook secret to paste into Carrybee's panel: long, random, URL-safe. */
function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The store's integrations: Meta, the couriers (Pathao, Carrybee), BDCourier.
 * Secrets are write-only. Each courier has a switch: off hides it from the
 * order lists but keeps its credentials; on opens its credentials panel.
 */
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
  const [testing, setTesting] = React.useState<"pathao" | "carrybee" | null>(null);
  const [test, setTest] = React.useState<PathaoTest | null>(null);
  const [cbTest, setCbTest] = React.useState<CarrybeeTest | null>(null);
  // A webhook secret generated here, shown in clear until saved so it can be
  // copied into Carrybee's panel; after saving only its hint is ever shown.
  const [newHookSecret, setNewHookSecret] = React.useState<string | null>(null);
  // Edits since the last save: the tests run against saved credentials only.
  const [dirty, setDirty] = React.useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const discard = () => {
    setD(draftFrom(current));
    setNewHookSecret(null);
    setDirty(false);
    setStatus(null);
  };

  const weight = Number(d.pathaoParcelWeightKg);
  const cbWeight = Number(d.carrybeeItemWeightG);
  const valid =
    weight >= 0.5 &&
    weight <= 10 &&
    (d.pathaoStoreId === "" || /^\d+$/.test(d.pathaoStoreId)) &&
    Number.isInteger(cbWeight) &&
    cbWeight >= 1 &&
    cbWeight <= 25000 &&
    /^\d*$/.test(d.carrybeeStoreId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await save();
  };

  /** Writes the draft; true when it was accepted. */
  const save = async (): Promise<boolean> => {
    if (!valid || busy) return false;
    setBusy(true);
    setStatus(null);
    try {
      const saved = await onSave({
        metaPixelId: d.metaPixelId.trim(),
        metaCapiToken: d.metaCapiToken,
        metaTestEventCode: d.metaTestEventCode.trim(),
        pathaoEnabled: d.pathaoEnabled,
        pathaoClientId: d.pathaoClientId.trim(),
        pathaoClientSecret: d.pathaoClientSecret,
        pathaoEmail: d.pathaoEmail.trim(),
        pathaoPassword: d.pathaoPassword,
        pathaoStoreId: d.pathaoStoreId === "" ? null : Number(d.pathaoStoreId),
        pathaoItemType: d.pathaoItemType,
        pathaoParcelWeightKg: d.pathaoParcelWeightKg,
        carrybeeEnabled: d.carrybeeEnabled,
        carrybeeClientId: d.carrybeeClientId.trim(),
        carrybeeClientSecret: d.carrybeeClientSecret,
        carrybeeClientContext: d.carrybeeClientContext,
        carrybeeStoreId: d.carrybeeStoreId.trim(),
        carrybeeProductType: d.carrybeeProductType,
        carrybeeItemWeightG: cbWeight,
        carrybeeWebhookSecret: d.carrybeeWebhookSecret,
        carrybeeIntegrationHeader: d.carrybeeIntegrationHeader.trim(),
        bdcourierApiKey: d.bdcourierApiKey,
      });
      setCurrent(saved);
      // Secrets were written (or cleared); the boxes go back to "keep".
      setD((prev) => ({
        ...prev,
        metaCapiToken: undefined,
        pathaoClientSecret: undefined,
        pathaoPassword: undefined,
        carrybeeClientSecret: undefined,
        carrybeeClientContext: undefined,
        carrybeeWebhookSecret: undefined,
        bdcourierApiKey: undefined,
      }));
      setNewHookSecret(null);
      setStatus({ ok: true, text: "Saved" });
      setDirty(false);
      return true;
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    // The test reads saved credentials, and the Save button is below the
    // fold: save pending edits first rather than test the previous values.
    if (dirty && !(await save())) return;
    setTesting("pathao");
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
      setTesting(null);
    }
  };

  const runCarrybeeTest = async () => {
    if (dirty && !(await save())) return;
    setTesting("carrybee");
    setCbTest(null);
    try {
      setCbTest(await testCarrybee(storeId));
    } catch (err) {
      setCbTest({
        configured: false,
        sandbox: true,
        baseUrl: "",
        storeId: "",
        stores: [],
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(null);
    }
  };

  const metaStatus: SectionStatus = current.metaPixelId || current.metaCapiTokenSet
    ? { label: "Connected", tone: "good" }
    : { label: "Not set", tone: "neutral" };
  const pathaoStatus: SectionStatus = !d.pathaoEnabled
    ? { label: "Off", tone: "neutral" }
    : test
      ? test.error
        ? { label: "Connection failed", tone: "warning" }
        : { label: "Connected", tone: "good" }
      : current.pathaoClientId && current.pathaoEmail
        ? { label: "Not verified", tone: "warning" }
        : { label: "Not set", tone: "neutral" };
  const carrybeeStatus: SectionStatus = !d.carrybeeEnabled
    ? { label: "Off", tone: "neutral" }
    : cbTest
      ? cbTest.error
        ? { label: "Connection failed", tone: "warning" }
        : { label: "Connected", tone: "good" }
      : current.carrybeeClientId && current.carrybeeClientSecretSet && current.carrybeeStoreId
        ? { label: "Not verified", tone: "warning" }
        : { label: "Not set", tone: "neutral" };
  const bdcourierStatus: SectionStatus = current.bdcourierApiKeySet
    ? { label: "Connected", tone: "good" }
    : { label: "Not set", tone: "neutral" };

  // The admin's own origin: Carrybee posts to it, and the /api rewrite takes
  // the call to the API. Empty while server-rendering.
  const origin = React.useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => ""
  );
  const webhookUrl =
    current.carrybeeWebhookPath && origin ? `${origin}${current.carrybeeWebhookPath}` : null;

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

      <Section
        title="Pathao"
        note="Courier"
        status={pathaoStatus}
        toggle={{ checked: d.pathaoEnabled, onChange: (on) => set("pathaoEnabled", on), label: "Use Pathao" }}
      >
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
              <Button type="button" variant="outline" size="sm" disabled={testing !== null || busy || !valid} onClick={runTest}>
                {testing === "pathao" ? "Testing…" : "Test connection"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {dirty ? "Saves your edits, then logs in to Pathao." : "Logs in to Pathao with the saved credentials."}
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

      <Section
        title="Carrybee"
        note={`Courier${current.carrybeeSandbox ? " · sandbox" : ""}`}
        status={carrybeeStatus}
        toggle={{ checked: d.carrybeeEnabled, onChange: (on) => set("carrybeeEnabled", on), label: "Use Carrybee" }}
      >
        <Field label="Client ID" htmlFor="cb-client">
          <Input id="cb-client" maxLength={120} autoComplete="off" value={d.carrybeeClientId} onChange={(e) => set("carrybeeClientId", e.target.value)} />
        </Field>
        <Field label="Client secret" htmlFor="cb-secret">
          <SecretInput id="cb-secret" isSet={current.carrybeeClientSecretSet} hint={current.carrybeeClientSecretHint} value={d.carrybeeClientSecret} onChange={(v) => set("carrybeeClientSecret", v)} />
        </Field>
        <Field label="Client context" htmlFor="cb-context">
          <SecretInput id="cb-context" isSet={current.carrybeeClientContextSet} hint={current.carrybeeClientContextHint} value={d.carrybeeClientContext} onChange={(v) => set("carrybeeClientContext", v)} />
        </Field>
        <Field label="Pickup store ID" htmlFor="cb-store">
          <Input id="cb-store" inputMode="numeric" value={d.carrybeeStoreId} onChange={(e) => set("carrybeeStoreId", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Product type">
          <Select value={String(d.carrybeeProductType)} onValueChange={(v) => set("carrybeeProductType", Number(v) as CarrybeeProductType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Parcel</SelectItem>
              <SelectItem value="2">Book</SelectItem>
              <SelectItem value="3">Document</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Weight per item (g)" htmlFor="cb-weight">
          <Input id="cb-weight" type="number" step="50" min={1} max={25000} value={d.carrybeeItemWeightG} onChange={(e) => set("carrybeeItemWeightG", e.target.value)} />
        </Field>
        <Field label="">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={testing !== null || busy || !valid} onClick={runCarrybeeTest}>
                {testing === "carrybee" ? "Testing…" : "Test connection"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {dirty ? "Saves your edits, then lists your Carrybee pickup stores." : "Lists your Carrybee pickup stores with the saved credentials."}
              </span>
            </div>
            {cbTest && (
              <div className="rounded-lg border p-3 text-sm">
                {cbTest.error ? (
                  <p className="text-destructive">{cbTest.error}</p>
                ) : (
                  <p className="text-muted-foreground">
                    Connected to Carrybee {cbTest.sandbox ? "sandbox" : "live"}.
                    {cbTest.stores.length > 0
                      ? " Pickup stores on this account:"
                      : " The account has no pickup stores yet — create one in Carrybee first."}
                  </p>
                )}
                {cbTest.stores.length > 0 && (
                  <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
                    {cbTest.stores.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="font-medium">{s.name}</span>{" "}
                          <span className="text-muted-foreground">#{s.id}</span>
                          {s.status && s.status !== "approved" && (
                            <span className="text-amber-700 dark:text-amber-400"> · {s.status}</span>
                          )}
                          {s.address && <span className="text-muted-foreground"> · {s.address}</span>}
                        </span>
                        {s.id === d.carrybeeStoreId ? (
                          <span className="shrink-0 text-xs text-muted-foreground">selected</span>
                        ) : (
                          <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => set("carrybeeStoreId", s.id)}>
                            Use this store
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
        <Field label="Webhook secret" htmlFor="cb-hook">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <SecretInput
                  id="cb-hook"
                  isSet={current.carrybeeWebhookSecretSet}
                  hint={current.carrybeeWebhookSecretHint}
                  value={d.carrybeeWebhookSecret}
                  onChange={(v) => {
                    setNewHookSecret(null);
                    set("carrybeeWebhookSecret", v);
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  const secret = randomSecret();
                  setNewHookSecret(secret);
                  set("carrybeeWebhookSecret", secret);
                }}
              >
                Generate
              </Button>
            </div>
            {newHookSecret && (
              <div className="flex items-center gap-2 text-xs">
                <code className="min-w-0 truncate rounded bg-muted px-2 py-1 font-mono">{newHookSecret}</code>
                <CopyButton text={newHookSecret} />
                <span className="text-muted-foreground">Copy it into Carrybee, then save.</span>
              </div>
            )}
          </div>
        </Field>
        <Field label="Integration header" htmlFor="cb-integration">
          <div className="flex flex-col gap-1.5">
            <Input
              id="cb-integration"
              maxLength={100}
              autoComplete="off"
              className="font-mono"
              placeholder="40489fe0-…"
              value={d.carrybeeIntegrationHeader}
              onChange={(e) => set("carrybeeIntegrationHeader", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Copy the value Carrybee shows under &ldquo;The header
              X-CB-Webhook-Integration-Header value should be exactly&rdquo;.
            </p>
          </div>
        </Field>
        <Field label="Webhook URL">
          {webhookUrl ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">{webhookUrl}</code>
                <CopyButton text={webhookUrl} />
              </div>
              <p className="text-xs text-muted-foreground">
                Paste this URL and the webhook secret into Carrybee → Webhook Integration, and select all events.
                Delivery statuses then arrive by themselves.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Switch Carrybee on and save to get the store&apos;s webhook URL.</p>
          )}
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

function CopyButton({ text }: { text: string }) {
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
  toggle,
  children,
}: {
  title: string;
  note?: string;
  status?: SectionStatus;
  /** A switch in the header; while off, the body folds away. */
  toggle?: { checked: boolean; onChange: (on: boolean) => void; label: string };
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
          {toggle && (
            <Switch checked={toggle.checked} onCheckedChange={toggle.onChange} aria-label={toggle.label} />
          )}
        </div>
      </div>
      {open && <div className="flex flex-col px-5">{children}</div>}
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
