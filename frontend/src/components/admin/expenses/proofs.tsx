"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ImageOff,
  ImagePlus,
  Loader2,
  Maximize2,
  RotateCw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteExpenseProof,
  getExpenseProofFile,
  getExpenseProofThumb,
  listExpenseProofs,
  type ExpenseProof,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/** What the picker accepts; the API checks the bytes again. */
export const PROOF_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";
export const MAX_PROOFS = 10;

const isPdf = (mime: string) => mime === "application/pdf";

/**
 * A proof's file as a local blob: URL. Fetched through the API (which checks
 * CRM access) and released when the component goes, so the picture exists
 * only in this tab — there is no address to share.
 */
function useProofUrl(
  proofId: number,
  kind: "file" | "thumb" = "file"
): { url: string | null; error: string | null } {
  const [state, setState] = React.useState<{ url: string | null; error: string | null }>({
    url: null,
    error: null,
  });
  React.useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setState({ url: null, error: null });
    (kind === "thumb" ? getExpenseProofThumb : getExpenseProofFile)(proofId)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ url, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ url: null, error: err instanceof Error ? err.message : "Could not load" });
        }
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [proofId, kind]);
  return state;
}

function ProofThumb({
  proof,
  onOpen,
  onDelete,
}: {
  proof: ExpenseProof;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const { url, error } = useProofUrl(proof.id, "thumb");
  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
      <button
        type="button"
        onClick={onOpen}
        title={proof.filename}
        className="flex size-full items-center justify-center"
      >
        {error ? (
          // No preview (a PDF Drive has not previewed yet): name it instead.
          <span className="flex flex-col items-center gap-1 px-1 text-[10px] text-muted-foreground">
            <FileText className="size-6" />
            <span className="line-clamp-2 break-all">{proof.filename}</span>
          </span>
        ) : !url ? (
          <Skeleton className="size-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, nothing for next/image to optimise
          <img src={url} alt={proof.filename} className="size-full object-cover" />
        )}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Remove ${proof.filename}`}
          className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** One proof, full size: the picture, or the PDF in the browser's viewer. */
function ProofViewer({
  proof,
  onClose,
}: {
  proof: ExpenseProof | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={proof !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-4xl">
        <DialogTitle className="truncate pr-6 text-base">{proof?.filename}</DialogTitle>
        {proof && <ProofFull proof={proof} />}
      </DialogContent>
    </Dialog>
  );
}

function ProofFull({ proof }: { proof: ExpenseProof }) {
  const { url, error } = useProofUrl(proof.id);
  if (error) return <p className="py-10 text-center text-sm text-destructive">{error}</p>;
  if (!url) return <Skeleton className="h-[60vh] w-full" />;
  return isPdf(proof.mime_type) ? (
    <iframe src={url} title={proof.filename} className="h-[75vh] w-full rounded-md border" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- a blob: URL
    <img
      src={url}
      alt={proof.filename}
      className="mx-auto max-h-[75vh] w-auto rounded-md object-contain"
    />
  );
}

/**
 * An expense's proofs as thumbnails; click one to see it full size. With
 * `editable`, each can be removed (moved to Drive's bin).
 */
export function ProofGallery({
  expenseId,
  version = 0,
  editable = false,
  onChanged,
}: {
  expenseId: number;
  /** Bump to reload, e.g. after an upload. */
  version?: number;
  editable?: boolean;
  onChanged?: (count: number) => void;
}) {
  const [proofs, setProofs] = React.useState<ExpenseProof[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<ExpenseProof | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listExpenseProofs(expenseId)
      .then((p) => !cancelled && setProofs(p))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, [expenseId, version]);

  const remove = async (proof: ExpenseProof) => {
    setError(null);
    try {
      await deleteExpenseProof(proof.id);
      const next = (proofs ?? []).filter((p) => p.id !== proof.id);
      setProofs(next);
      onChanged?.(next.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (proofs === null) return <Skeleton className="h-20 w-full" />;
  if (proofs.length === 0) {
    return <p className="text-sm text-muted-foreground">No proof attached.</p>;
  }
  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        {proofs.map((p) => (
          <ProofThumb
            key={p.id}
            proof={p}
            onOpen={() => setOpen(p)}
            onDelete={editable ? () => remove(p) : undefined}
          />
        ))}
      </div>
      <ProofViewer proof={open} onClose={() => setOpen(null)} />
    </>
  );
}

/**
 * Files chosen in the drawer, not yet uploaded: previews from the files
 * themselves (nothing leaves the browser until Save).
 */
export function PendingProofs({
  files,
  onChange,
  room,
  uploading,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  /** How many more the expense can take. */
  room: number;
  uploading: boolean;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const previews = React.useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files]
  );
  React.useEffect(
    () => () => previews.forEach((u) => u && URL.revokeObjectURL(u)),
    [previews]
  );

  return (
    <div className="grid gap-2">
      {files.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="relative aspect-square overflow-hidden rounded-md border bg-muted"
              title={f.name}
            >
              {previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview
                <img src={previews[i]!} alt={f.name} className="size-full object-cover" />
              ) : (
                <span className="flex size-full flex-col items-center justify-center gap-1 px-1 text-[10px] text-muted-foreground">
                  <FileText className="size-6" />
                  <span className="line-clamp-2 break-all">{f.name}</span>
                </span>
              )}
              {uploading ? (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="size-5 animate-spin" />
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={PROOF_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          onChange([...files, ...picked].slice(0, Math.max(0, room)));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={uploading || room <= files.length}
        onClick={() => input.current?.click()}
        className={cn(
          "flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          (uploading || room <= files.length) && "pointer-events-none opacity-50"
        )}
      >
        <ImagePlus className="size-4" />
        {room <= files.length ? `At most ${MAX_PROOFS} per expense` : "Add receipt or screenshot"}
      </button>
      <p className="text-xs text-muted-foreground">
        JPG, PNG, WebP, GIF or PDF, up to 10 MB each. Kept privately in Google Drive.
      </p>
    </div>
  );
}

/**
 * The table's proof cell: the first proof as a small thumbnail, "+2" when
 * there are more. The row's own click opens the details.
 */
export function ProofCell({ proofs }: { proofs: { id: number; mime_type: string }[] }) {
  if (proofs.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="relative inline-flex">
      <CellThumb proofId={proofs[0].id} />
      {proofs.length > 1 && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full border bg-background px-1 text-[10px] font-medium tabular-nums shadow-sm">
          +{proofs.length - 1}
        </span>
      )}
    </span>
  );
}

function CellThumb({ proofId }: { proofId: number }) {
  const { url, error } = useProofUrl(proofId, "thumb");
  return (
    <span className="flex size-10 items-center justify-center overflow-hidden rounded-md border bg-muted">
      {error ? (
        <FileText className="size-4 text-muted-foreground" />
      ) : !url ? (
        <Skeleton className="size-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a blob: URL
        <img src={url} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.5;

/**
 * An expense's proofs, large, inside the details modal: zoom in and out,
 * drag to move around a zoomed photo, double-click to toggle, rotate a
 * sideways receipt; arrows and a strip when there are several. PDFs open in
 * the browser's own viewer, which has its own zoom.
 */
export function ProofStage({ expenseId }: { expenseId: number }) {
  const [proofs, setProofs] = React.useState<ExpenseProof[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    listExpenseProofs(expenseId)
      .then((p) => !cancelled && setProofs(p))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (proofs === null) return <Skeleton className="h-[60vh] w-full" />;
  if (proofs.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
        <ImageOff className="size-6" />
        No proof attached
      </div>
    );
  }
  const current = Math.min(index, proofs.length - 1);
  const proof = proofs[current];
  const go = (step: number) => setIndex((current + step + proofs.length) % proofs.length);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <StageFile key={proof.id} proof={proof} />
      {proofs.length > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous proof" onClick={() => go(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex flex-1 gap-2 overflow-x-auto p-1">
            {proofs.map((p, i) => (
              <button
                key={p.id}
                type="button"
                aria-label={`Show ${p.filename}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "shrink-0 rounded-md ring-offset-2 ring-offset-background",
                  i === current && "ring-2 ring-primary"
                )}
              >
                <CellThumb proofId={p.id} />
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {current + 1} / {proofs.length}
          </span>
          <Button variant="outline" size="icon" aria-label="Next proof" onClick={() => go(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function StageFile({ proof }: { proof: ExpenseProof }) {
  const { url, error } = useProofUrl(proof.id);
  const [zoom, setZoom] = React.useState(1);
  const [turn, setTurn] = React.useState(0);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const zoomTo = (z: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };

  if (error) {
    return <p className="py-16 text-center text-sm text-destructive">{error}</p>;
  }
  if (!url) return <Skeleton className="h-[60vh] w-full" />;
  if (isPdf(proof.mime_type)) {
    return <iframe src={url} title={proof.filename} className="h-[65vh] w-full rounded-lg border" />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground" title={proof.filename}>
          {proof.filename}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            disabled={zoom <= ZOOM_MIN}
            onClick={() => zoomTo(zoom - ZOOM_STEP)}
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => zoomTo(zoom + ZOOM_STEP)}
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Fit to view"
            title="Fit to view"
            onClick={() => {
              zoomTo(1);
              setTurn(0);
            }}
          >
            <Maximize2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Rotate"
            title="Rotate"
            onClick={() => setTurn((t) => (t + 90) % 360)}
          >
            <RotateCw className="size-4" />
          </Button>
        </div>
      </div>
      <div
        className={cn(
          "relative flex h-[60vh] touch-none select-none items-center justify-center overflow-hidden rounded-lg border bg-muted/40",
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        )}
        onDoubleClick={() => zoomTo(zoom > 1 ? 1 : 2)}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL */}
        <img
          src={url}
          alt={proof.filename}
          draggable={false}
          className="max-h-full max-w-full object-contain transition-transform duration-100"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${turn}deg)` }}
        />
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        Double-click to zoom · drag to move around when zoomed
      </p>
    </div>
  );
}
