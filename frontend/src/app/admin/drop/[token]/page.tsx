"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Camera, CheckCircle2, CircleAlert, FileText, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DropInfo } from "@/lib/api";

/**
 * The page a phone opens from the expense drawer's QR code. No sign-in: the
 * link's secret is the key, good for 15 minutes and for adding pictures to
 * that one drawer only. Pictures go through the API straight to Google
 * Drive; the drawer on the computer shows them as they land.
 *
 * Lives under /admin (so it gets the admin's styles) but outside the
 * signed-in (dashboard) group, like the login page.
 */
export default function DropPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = React.useState<DropInfo | null>(null);
  const [fatal, setFatal] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<{ name: string; preview: string | null }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const camera = React.useRef<HTMLInputElement>(null);
  const gallery = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetch(`/api/drop/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await detail(r));
        setInfo((await r.json()) as DropInfo);
      })
      .catch((err) => setFatal(err instanceof Error ? err.message : "This link is not valid"));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [token]);

  const left = info ? Math.max(0, Math.round((new Date(info.expires_at).getTime() - now) / 1000)) : 0;
  const room = info ? info.max_files - info.received : 0;

  const send = async (picked: File[]) => {
    if (!picked.length || !info) return;
    setBusy(true);
    setError(null);
    try {
      const ready = await Promise.all(picked.slice(0, room).map(prepare));
      const big = ready.find((f) => f.size > info.max_bytes);
      if (big) throw new Error(`${big.name} is larger than ${Math.round(info.max_bytes / 1048576)} MB`);
      const body = new FormData();
      ready.forEach((f) => body.append("files", f));
      const r = await fetch(`/api/drop/${encodeURIComponent(token)}/files`, { method: "POST", body });
      if (!r.ok) throw new Error(await detail(r));
      setInfo((await r.json()) as DropInfo);
      setSent((s) => [
        ...s,
        ...ready.map((f) => ({
          name: f.name,
          preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        })),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  if (fatal) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <CircleAlert className="size-10 text-destructive" />
          <p className="font-medium">{fatal}</p>
          <p className="text-sm text-muted-foreground">
            Open the expense on the computer and show a new QR code.
          </p>
        </div>
      </Shell>
    );
  }
  if (!info) {
    return (
      <Shell>
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  const expired = left === 0;
  return (
    <Shell>
      <div className="text-center">
        <h1 className="text-xl font-semibold">Send a receipt</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          to the expense being added for <span className="font-medium text-foreground">{info.store_name}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {expired
            ? "This link has expired."
            : `Link open for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
        </p>
      </div>

      {!expired && room > 0 && (
        <div className="grid gap-3">
          <Button
            size="lg"
            className="h-14 gap-2 text-base"
            disabled={busy}
            onClick={() => camera.current?.click()}
          >
            <Camera className="size-5" />
            Take a photo
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 gap-2 text-base"
            disabled={busy}
            onClick={() => gallery.current?.click()}
          >
            <ImagePlus className="size-5" />
            Choose from gallery
          </Button>
          {/* capture opens the camera directly; the second takes photos or PDFs. */}
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              send(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <input
            ref={gallery}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              send(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      )}

      {busy && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Sending…
        </p>
      )}
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      {!expired && room <= 0 && (
        <p className="text-center text-sm text-muted-foreground">
          That is the most one expense can take ({info.max_files}).
        </p>
      )}

      {sent.length > 0 && (
        <div className="grid gap-2">
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
            {sent.length} sent — they are on the computer now
          </p>
          <div className="grid grid-cols-3 gap-2">
            {sent.map((s, i) => (
              <div key={i} className="aspect-square overflow-hidden rounded-md border bg-muted">
                {s.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview
                  <img src={s.preview} alt={s.name} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-1 px-1 text-[10px] text-muted-foreground">
                    <FileText className="size-6" />
                    <span className="line-clamp-2 break-all">{s.name}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Finish on the computer: the pictures are filed when the expense is saved.
          </p>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-svh bg-background px-4 py-8">
      <div className="mx-auto flex max-w-sm flex-col gap-6">{children}</div>
    </main>
  );
}

async function detail(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // not JSON
  }
  return r.status === 410 ? "This link has expired" : "Something went wrong";
}

const MAX_SIDE = 2400;

/**
 * A photo made ready to send: drawn onto a canvas and saved as a JPEG at
 * most MAX_SIDE px on its longest side. That turns an iPhone's HEIC into
 * something the server accepts, and a 12-megapixel photo into a few hundred
 * KB — still sharp enough to read a receipt. PDFs, GIFs and anything the
 * browser cannot draw go as they are.
 */
async function prepare(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/jpeg", 0.85)
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
