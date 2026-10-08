"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Check, Copy, FileText, Loader2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  attachProofDrop,
  createProofDrop,
  discardProofDrop,
  getProofDrop,
  getProofDropThumb,
  removeProofDropFile,
  type DropFile,
} from "@/lib/api";

const POLL_MS = 2000;

/**
 * The drawer's "send from phone" link: a QR code for a one-time page where a
 * phone uploads pictures straight to Google Drive. While it is open the
 * drawer polls for what arrived. On save the drawer calls `attach`; if the
 * drawer goes without saving, what arrived is binned (`discard`, also run on
 * unmount), and the server bins it anyway when the link expires.
 */
export function usePhoneDrop() {
  const [drop, setDrop] = React.useState<{
    id: number;
    url: string;
    qr: string;
    expiresAt: number;
  } | null>(null);
  const [files, setFiles] = React.useState<DropFile[]>([]);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  // The id survives re-renders for the unmount cleanup.
  const live = React.useRef<number | null>(null);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const d = await createProofDrop();
      const url = `${window.location.origin}/drop/${d.token}`;
      const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      live.current = d.id;
      setFiles([]);
      setDrop({ id: d.id, url, qr, expiresAt: new Date(d.expires_at).getTime() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not make a link");
    } finally {
      setStarting(false);
    }
  };

  // Poll for arrivals, and tick the countdown, while a link is open.
  React.useEffect(() => {
    if (!drop) return;
    let cancelled = false;
    const tick = async () => {
      setNow(Date.now());
      if (Date.now() > drop.expiresAt) return;
      try {
        const d = await getProofDrop(drop.id);
        if (!cancelled) setFiles(d.files);
      } catch {
        // A missed poll is retried on the next tick.
      }
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [drop]);

  // Leaving the drawer without saving: bin whatever the phone sent.
  React.useEffect(
    () => () => {
      if (live.current !== null) discardProofDrop(live.current).catch(() => {});
    },
    []
  );

  const remove = async (file: DropFile) => {
    if (!drop) return;
    setFiles((f) => f.filter((x) => x.id !== file.id));
    try {
      await removeProofDropFile(drop.id, file.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    }
  };

  /** File what arrived with a saved expense; the link is used up. */
  const attach = async (expenseId: number) => {
    if (!drop) return;
    if (files.length === 0) {
      await discard();
      return;
    }
    await attachProofDrop(drop.id, expenseId);
    live.current = null;
    setDrop(null);
    setFiles([]);
  };

  const discard = async () => {
    const id = live.current;
    live.current = null;
    setDrop(null);
    setFiles([]);
    if (id !== null) await discardProofDrop(id).catch(() => {});
  };

  return {
    drop,
    files,
    starting,
    error,
    secondsLeft: drop ? Math.max(0, Math.round((drop.expiresAt - now) / 1000)) : 0,
    start,
    remove,
    attach,
    discard,
  };
}

export type PhoneDrop = ReturnType<typeof usePhoneDrop>;

/** The QR code panel and what has arrived through it. */
export function PhoneDropPanel({ phone, disabled }: { phone: PhoneDrop; disabled: boolean }) {
  const { drop, files, starting, error, secondsLeft } = phone;

  if (!drop) {
    return (
      <div className="grid gap-1">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || starting}
          onClick={phone.start}
          className="gap-2"
        >
          {starting ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
          Send from phone
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  const expired = secondsLeft === 0;
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm">
          <div className="font-medium">Scan with your phone</div>
          <div className="text-xs text-muted-foreground">
            {expired ? "This QR code has expired." : `Opens an upload page · ${mm}:${ss} left`}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close the QR code"
          onClick={phone.discard}
        >
          <X className="size-4" />
        </Button>
      </div>

      {expired ? (
        <Button type="button" variant="outline" onClick={phone.start}>
          New QR code
        </Button>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div
            className="size-44 rounded-md bg-white p-2 [&_svg]:size-full"
            // An SVG made from the link by the qrcode library, not user input.
            dangerouslySetInnerHTML={{ __html: drop.qr }}
            role="img"
            aria-label="QR code for uploading from a phone"
          />
          {/* For a phone that will not scan: send the link another way. */}
          <CopyLink url={drop.url} />
        </div>
      )}

      <div className="grid gap-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {files.length === 0 ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              Waiting for pictures from the phone…
            </>
          ) : (
            `${files.length} received — saved with the expense.`
          )}
        </div>
        {files.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {files.map((f) => (
              <DropThumb key={f.id} dropId={drop.id} file={f} onRemove={() => phone.remove(f)} />
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function DropThumb({
  dropId,
  file,
  onRemove,
}: {
  dropId: number;
  file: DropFile;
  onRemove: () => void;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    getProofDropThumb(dropId, file.id)
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [dropId, file.id]);

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border bg-muted" title={file.filename}>
      {failed ? (
        <span className="flex size-full flex-col items-center justify-center gap-1 px-1 text-[10px] text-muted-foreground">
          <FileText className="size-6" />
          <span className="line-clamp-2 break-all">{file.filename}</span>
        </span>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a blob: URL
        <img src={url} alt={file.filename} className="size-full object-cover" />
      ) : (
        <Skeleton className="size-full" />
      )}
      <button
        type="button"
        aria-label={`Remove ${file.filename}`}
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-destructive"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", url);
        }
      }}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
