"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  CopyButton,
  CopyField,
  Field,
  Section,
  randomSecret,
  useOrigin,
} from "@/components/admin/settings/form-parts";
import { SecretInput } from "@/components/admin/stores/secret-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createCourierAccount,
  deleteCourierAccount,
  listCourierAccounts,
  testCourierAccount,
  updateCourierAccount,
  type CourierAccount,
  type CourierAccountInput,
  type CourierAccountTest,
} from "@/lib/api";
import { COURIER_LABELS, type CourierName } from "@/lib/orders";
import { cn } from "@/lib/utils";

const COURIERS: CourierName[] = ["pathao", "carrybee"];

/** What each courier's Webhook Integration page calls the pieces we hold. */
const WEBHOOK_HINTS: Record<CourierName, { header: string; placeholder: string }> = {
  pathao: { header: "X-Pathao-Merchant-Webhook-Integration-Secret", placeholder: "f3992ecc-…" },
  carrybee: { header: "X-CB-Webhook-Integration-Header", placeholder: "40489fe0-…" },
};

/**
 * Settings → Courier: the Pathao and Carrybee merchant accounts our stores
 * book through. One card per account at the courier, however many stores
 * use it — the courier calls one webhook per account, so its URL and secret
 * are set up here once. Stores pick an account in their own settings.
 */
export function CourierAccounts() {
  const [accounts, setAccounts] = React.useState<CourierAccount[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // A courier whose new, unsaved account card is open.
  const [adding, setAdding] = React.useState<CourierName | null>(null);

  React.useEffect(() => {
    listCourierAccounts()
      .then(setAccounts)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!accounts) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const replace = (saved: CourierAccount) =>
    setAccounts((prev) => {
      const list = prev ?? [];
      return list.some((a) => a.id === saved.id)
        ? list.map((a) => (a.id === saved.id ? saved : a))
        : [...list, saved];
    });

  return (
    <div className="flex flex-col gap-8">
      {COURIERS.map((courier) => {
        const label = COURIER_LABELS[courier];
        const mine = accounts.filter((a) => a.courier === courier);
        return (
          <div key={courier} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{label} accounts</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={adding !== null}
                onClick={() => setAdding(courier)}
              >
                <Plus className="size-4" />
                Add {label} account
              </Button>
            </div>
            {mine.length === 0 && adding !== courier && (
              <p className="text-sm text-muted-foreground">
                No {label} account yet. Add the merchant account your stores book with.
              </p>
            )}
            {mine.map((account) => (
              <AccountCard
                key={account.id}
                courier={courier}
                account={account}
                onSaved={replace}
                onDeleted={() => setAccounts((prev) => (prev ?? []).filter((a) => a.id !== account.id))}
              />
            ))}
            {adding === courier && (
              <AccountCard
                courier={courier}
                account={null}
                onSaved={(saved) => {
                  replace(saved);
                  setAdding(null);
                }}
                onCancel={() => setAdding(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type Draft = Omit<CourierAccountInput, "courier">;

function draftFrom(account: CourierAccount | null): Draft {
  return {
    name: account?.name ?? "",
    clientId: account?.clientId ?? "",
    username: account?.username ?? "",
    integrationHeader: account?.integrationHeader ?? "",
  };
}

function AccountCard({
  courier,
  account,
  onSaved,
  onDeleted,
  onCancel,
}: {
  courier: CourierName;
  /** null: a new account, not saved yet. */
  account: CourierAccount | null;
  onSaved: (account: CourierAccount) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}) {
  const origin = useOrigin();
  const label = COURIER_LABELS[courier];
  const [d, setD] = React.useState<Draft>(() => draftFrom(account));
  const [dirty, setDirty] = React.useState(account === null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = React.useState<CourierAccountTest | null>(null);
  const [testing, setTesting] = React.useState(false);
  // A secret generated here is shown in clear while it is still the draft,
  // so it can be copied into the courier's panel; once saved only its hint
  // is ever shown.
  const [generated, setGenerated] = React.useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const shownSecret = generated !== null && d.webhookSecret === generated ? generated : null;
  const valid = d.name.trim().length > 0;

  /** Writes the draft; the saved account, or null when refused. */
  const save = async (): Promise<CourierAccount | null> => {
    if (!valid || busy) return null;
    setBusy(true);
    setStatus(null);
    try {
      const input: CourierAccountInput = { ...d, courier, name: d.name.trim() };
      const saved = account
        ? await updateCourierAccount(account.id, input)
        : await createCourierAccount(input);
      onSaved(saved);
      // Secrets were written (or cleared); the boxes go back to "keep".
      setD({ ...draftFrom(saved) });
      setDirty(false);
      setStatus({ ok: true, text: "Saved" });
      return saved;
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    // The test reads the saved account: save pending edits first.
    const target = dirty || !account ? await save() : account;
    if (!target) return;
    setTesting(true);
    setTest(null);
    try {
      setTest(await testCourierAccount(target.id));
    } catch (err) {
      setTest({ sandbox: true, stores: [], error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!account || !onDeleted) return;
    if (!window.confirm(`Delete the ${label} account “${account.name}”?`)) return;
    setBusy(true);
    try {
      await deleteCourierAccount(account.id);
      onDeleted();
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Could not delete" });
      setBusy(false);
    }
  };

  const hints = WEBHOOK_HINTS[courier];
  // Unique per card, for the labels.
  const key = `acc-${account?.id ?? "new"}-${courier}`;
  const usedBy = account?.usedBy ?? [];

  return (
    <Section
      title={account ? account.name : `New ${label} account`}
      note={account ? `${label}${account.sandbox ? " · sandbox" : ""}` : undefined}
      actions={
        account && onDeleted ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Delete account"
            title={usedBy.length > 0 ? "In use — pick another account in those stores first" : "Delete account"}
            disabled={busy || usedBy.length > 0}
            onClick={remove}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : undefined
      }
    >
      <Field label="Name" htmlFor={`${key}-name`}>
        <Input
          id={`${key}-name`}
          maxLength={120}
          placeholder={`e.g. Nature Bazar ${label}`}
          value={d.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <Field label="Client ID" htmlFor={`${key}-client`}>
        <Input id={`${key}-client`} maxLength={120} autoComplete="off" value={d.clientId} onChange={(e) => set("clientId", e.target.value)} />
      </Field>
      <Field label="Client secret" htmlFor={`${key}-secret`}>
        <SecretInput
          id={`${key}-secret`}
          isSet={account?.clientSecretSet ?? false}
          hint={account?.clientSecretHint ?? null}
          value={d.clientSecret}
          onChange={(v) => set("clientSecret", v)}
        />
      </Field>
      {courier === "pathao" ? (
        <>
          <Field label="Client email" htmlFor={`${key}-email`}>
            <Input id={`${key}-email`} type="email" maxLength={255} value={d.username} onChange={(e) => set("username", e.target.value)} />
          </Field>
          <Field label="Password" htmlFor={`${key}-password`}>
            <SecretInput
              id={`${key}-password`}
              isSet={account?.passwordSet ?? false}
              hint={null}
              value={d.password}
              onChange={(v) => set("password", v)}
            />
          </Field>
        </>
      ) : (
        <Field label="Client context" htmlFor={`${key}-context`}>
          <SecretInput
            id={`${key}-context`}
            isSet={account?.clientContextSet ?? false}
            hint={account?.clientContextHint ?? null}
            value={d.clientContext}
            onChange={(v) => set("clientContext", v)}
          />
        </Field>
      )}
      <Field label="">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" disabled={testing || busy || !valid} onClick={runTest}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {dirty || !account ? `Saves, then lists the ${label} stores this account can book from.` : `Lists the ${label} stores this account can book from.`}
            </span>
          </div>
          {test && (
            <div className="rounded-lg border p-3 text-sm">
              {test.error ? (
                <p className="text-destructive">{test.error}</p>
              ) : (
                <p className="text-muted-foreground">
                  Connected to {label} {test.sandbox ? "sandbox" : "live"}.
                  {test.stores.length > 0 ? " Its stores (each of ours picks one as its pickup store):" : " It has no stores yet."}
                </p>
              )}
              {test.stores.length > 0 && (
                <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto">
                  {test.stores.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.name}</span>{" "}
                      <span className="text-muted-foreground">#{s.id}</span>
                      {s.address && <span className="text-muted-foreground"> · {s.address}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Field>
      <Field label="Webhook secret" htmlFor={`${key}-hook`}>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <SecretInput
                id={`${key}-hook`}
                isSet={account?.webhookSecretSet ?? false}
                hint={account?.webhookSecretHint ?? null}
                value={d.webhookSecret}
                onChange={(v) => set("webhookSecret", v)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                if (
                  account?.webhookSecretSet &&
                  !window.confirm(
                    `Replace the webhook secret? ${label} keeps sending the old one until you paste the new one into its panel.`
                  )
                ) {
                  return;
                }
                const value = randomSecret();
                setGenerated(value);
                set("webhookSecret", value);
              }}
            >
              Generate
            </Button>
          </div>
          {shownSecret && (
            <div className="flex items-center gap-2 text-xs">
              <code className="min-w-0 truncate rounded bg-muted px-2 py-1 font-mono">{shownSecret}</code>
              <CopyButton text={shownSecret} />
              <span className="text-muted-foreground">Copy it into {label}, then save.</span>
            </div>
          )}
        </div>
      </Field>
      <Field label="Integration header" htmlFor={`${key}-integration`}>
        <div className="flex flex-col gap-1.5">
          <Input
            id={`${key}-integration`}
            maxLength={100}
            autoComplete="off"
            className="font-mono"
            placeholder={hints.placeholder}
            value={d.integrationHeader}
            onChange={(e) => set("integrationHeader", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Copy the value {label} shows for the header {hints.header} on its Webhook Integration page.
          </p>
        </div>
      </Field>
      <Field label="Webhook URL">
        {account && origin ? (
          <div className="flex flex-col gap-1.5">
            <CopyField value={`${origin}${account.webhookPath}`} />
            <p className="text-xs text-muted-foreground">
              Paste this URL and the webhook secret into {label} → Webhook Integration once, with every event
              selected. It serves every store using this account.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Save the account to get its webhook URL.</p>
        )}
      </Field>
      {account && (
        <Field label="Used by">
          <p className="text-sm">
            {usedBy.length > 0 ? (
              usedBy.map((s) => s.name).join(", ")
            ) : (
              <span className="text-muted-foreground">
                No store yet — pick this account under {label} in a store&apos;s settings.
              </span>
            )}
          </p>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3 py-3.5">
        <Button type="button" size="sm" disabled={busy || !valid || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : account ? "Save account" : "Create account"}
        </Button>
        {account ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || !dirty}
            onClick={() => {
              setD(draftFrom(account));
              setDirty(false);
              setStatus(null);
            }}
          >
            Discard
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <p
          className={cn(
            "ml-auto text-xs",
            status && !status.ok ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {status ? status.text : dirty ? "Unsaved changes" : ""}
        </p>
      </div>
    </Section>
  );
}
