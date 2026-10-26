"use client";

import * as React from "react";
import Link from "next/link";

import {
  CopyField,
  Field,
  Section,
  useOrigin,
  type SectionStatus,
} from "@/components/admin/settings/form-parts";
import { SecretInput } from "@/components/admin/stores/secret-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  testCarrybee,
  testPathao,
  type CarrybeeProductType,
  type CarrybeeTest,
  type CourierAccountBrief,
  type PathaoTest,
  type StoreSettings,
  type StoreSettingsInput,
} from "@/lib/api";
import { COURIER_LABELS, type CourierName } from "@/lib/orders";

type ItemType = StoreSettings["pathaoItemType"];

type Draft = {
  metaPixelId: string;
  metaCapiToken?: string;
  metaTestEventCode: string;
  pathaoAccountId: number | null;
  pathaoEnabled: boolean;
  pathaoStoreId: string;
  pathaoItemType: ItemType;
  pathaoParcelWeightKg: string;
  carrybeeAccountId: number | null;
  carrybeeEnabled: boolean;
  carrybeeStoreId: string;
  carrybeeProductType: CarrybeeProductType;
  carrybeeItemWeightG: string;
  bdcourierApiKey?: string;
};

function draftFrom(settings: StoreSettings): Draft {
  return {
    metaPixelId: settings.metaPixelId,
    metaTestEventCode: settings.metaTestEventCode,
    pathaoAccountId: settings.pathaoAccount?.id ?? null,
    pathaoEnabled: settings.pathaoEnabled,
    pathaoStoreId: settings.pathaoStoreId != null ? String(settings.pathaoStoreId) : "",
    pathaoItemType: settings.pathaoItemType,
    pathaoParcelWeightKg: settings.pathaoParcelWeightKg,
    carrybeeAccountId: settings.carrybeeAccount?.id ?? null,
    carrybeeEnabled: settings.carrybeeEnabled,
    carrybeeStoreId: settings.carrybeeStoreId,
    carrybeeProductType: settings.carrybeeProductType,
    carrybeeItemWeightG: String(settings.carrybeeItemWeightG),
  };
}

/**
 * The store's integrations: Meta, the couriers (Pathao, Carrybee), BDCourier.
 * Secrets are write-only. A courier's credentials and webhook belong to a
 * courier account (Settings → Courier) that a super admin picks here; the
 * store keeps its own switch, pickup store and parcel details.
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
  const [testing, setTesting] = React.useState<CourierName | null>(null);
  const [test, setTest] = React.useState<PathaoTest | null>(null);
  const [cbTest, setCbTest] = React.useState<CarrybeeTest | null>(null);
  // Edits since the last save: the tests run against saved settings only.
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
        // Only super admins choose accounts; for anyone else they are left
        // out, so the save never touches them.
        ...(current.canChooseAccounts
          ? { pathaoCourierAccountId: d.pathaoAccountId, carrybeeCourierAccountId: d.carrybeeAccountId }
          : {}),
        pathaoEnabled: d.pathaoEnabled,
        pathaoStoreId: d.pathaoStoreId === "" ? null : Number(d.pathaoStoreId),
        pathaoItemType: d.pathaoItemType,
        pathaoParcelWeightKg: d.pathaoParcelWeightKg,
        carrybeeEnabled: d.carrybeeEnabled,
        carrybeeStoreId: d.carrybeeStoreId.trim(),
        carrybeeProductType: d.carrybeeProductType,
        carrybeeItemWeightG: cbWeight,
        bdcourierApiKey: d.bdcourierApiKey,
      });
      setCurrent(saved);
      // Secrets were written (or cleared); the boxes go back to "keep".
      setD((prev) => ({ ...prev, metaCapiToken: undefined, bdcourierApiKey: undefined }));
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
    // The test reads saved settings, and the Save button is below the fold:
    // save pending edits first rather than test the previous values.
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
  const courierStatus = (
    on: boolean,
    account: CourierAccountBrief | null,
    tested: { error: string | null } | null
  ): SectionStatus =>
    !on
      ? { label: "Off", tone: "neutral" }
      : !account
        ? { label: "No account", tone: "warning" }
        : tested
          ? tested.error
            ? { label: "Connection failed", tone: "warning" }
            : { label: "Connected", tone: "good" }
          : { label: "Not verified", tone: "warning" };
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

      <Section
        title="Pathao"
        note="Courier"
        status={courierStatus(d.pathaoEnabled, current.pathaoAccount, test)}
        toggle={{ checked: d.pathaoEnabled, onChange: (on) => set("pathaoEnabled", on), label: "Use Pathao" }}
      >
        <AccountField
          courier="pathao"
          settings={current}
          value={d.pathaoAccountId}
          onChange={(id) => set("pathaoAccountId", id)}
        />
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
                {dirty ? "Saves your edits, then lists the account's Pathao stores." : "Lists the account's Pathao stores."}
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
        status={courierStatus(d.carrybeeEnabled, current.carrybeeAccount, cbTest)}
        toggle={{ checked: d.carrybeeEnabled, onChange: (on) => set("carrybeeEnabled", on), label: "Use Carrybee" }}
      >
        <AccountField
          courier="carrybee"
          settings={current}
          value={d.carrybeeAccountId}
          onChange={(id) => set("carrybeeAccountId", id)}
        />
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
          <Input id="cb-weight" type="number" step={1} min={1} max={25000} value={d.carrybeeItemWeightG} onChange={(e) => set("carrybeeItemWeightG", e.target.value)} />
        </Field>
        <Field label="">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={testing !== null || busy || !valid} onClick={runCarrybeeTest}>
                {testing === "carrybee" ? "Testing…" : "Test connection"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {dirty ? "Saves your edits, then lists the account's Carrybee pickup stores." : "Lists the account's Carrybee pickup stores."}
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

const NO_ACCOUNT = "none";

/**
 * Which courier account the store books through, and what that account
 * is: client id, login and the webhook URL it shares with every store on
 * it. Super admins pick from the accounts on Settings → Courier; everyone
 * else sees the choice read-only.
 */
function AccountField({
  courier,
  settings,
  value,
  onChange,
}: {
  courier: CourierName;
  settings: StoreSettings;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const origin = useOrigin();
  const label = COURIER_LABELS[courier];
  const saved = courier === "pathao" ? settings.pathaoAccount : settings.carrybeeAccount;
  const options = settings.accountOptions.filter((a) => a.courier === courier);
  // The draft's choice, known from the options (super admins) or the saved one.
  const shown = options.find((a) => a.id === value) ?? (saved?.id === value ? saved : null);

  return (
    <>
      <Field label="Account" htmlFor={`${courier}-account`}>
        <div className="flex flex-col gap-1.5">
          {settings.canChooseAccounts ? (
            <Select
              value={value != null ? String(value) : NO_ACCOUNT}
              onValueChange={(v) => onChange(v === NO_ACCOUNT ? null : Number(v))}
            >
              <SelectTrigger id={`${courier}-account`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>No account</SelectItem>
                {options.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm">{saved ? saved.name : <span className="text-muted-foreground">None chosen yet</span>}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {settings.canChooseAccounts ? (
              <>
                {label} credentials and the webhook are kept on{" "}
                <Link href="/admin/settings/courier" className="underline underline-offset-2">
                  Settings → Courier
                </Link>
                . Stores booking through one {label} account all pick the same one.
              </>
            ) : (
              `A super admin chooses the ${label} account.`
            )}
          </p>
        </div>
      </Field>
      {shown && (
        <>
          <Field label="Client ID">
            <p className="font-mono text-sm">{shown.clientId || "—"}</p>
          </Field>
          {courier === "pathao" && (
            <Field label="Client email">
              <p className="text-sm">{shown.username || "—"}</p>
            </Field>
          )}
          <Field label="Webhook URL">
            <div className="flex flex-col gap-1.5">
              {origin && <CopyField value={`${origin}${shown.webhookPath}`} />}
              <p className="text-xs text-muted-foreground">
                The account&apos;s webhook: it brings this store&apos;s parcel updates and those of every
                other store on the account.
                {!shown.webhookSecretSet && ` No webhook secret is saved on the account yet.`}
              </p>
            </div>
          </Field>
        </>
      )}
      {value !== (saved?.id ?? null) && (
        <p className="py-2 text-xs text-amber-700 dark:text-amber-400">Save settings to use this account.</p>
      )}
    </>
  );
}
