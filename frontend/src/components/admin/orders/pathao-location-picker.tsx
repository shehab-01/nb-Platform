"use client";

import * as React from "react";
import { Check, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  listPathaoAreas,
  listPathaoCities,
  listPathaoZones,
  parseAddress,
  type PathaoPlace,
} from "@/lib/api";
import { ApiError } from "@/lib/http";
import {
  EMPTY_LOCATION,
  type PathaoConfidence,
  type PathaoLocation,
} from "@/lib/orders";
import { cn } from "@/lib/utils";

/** Wait this long after the last keystroke before asking Pathao. */
const PARSE_DEBOUNCE_MS = 500;
/** Under this there is nothing Pathao could place. */
const MIN_ADDRESS_CHARS = 10;

/**
 * The City / Zone / Area Pathao needs for a booking, filled in from the
 * address text by Pathao's parser and always editable by hand.
 *
 * Typing in the address (the `address` prop) re-parses after a pause; the
 * parent bumps `parseSignal` on blur to parse at once. A choice staff made
 * themselves is never overwritten by a later parse — only the re-parse
 * button does that. Everything about the parser failing is silent: the
 * dropdowns are simply left to staff. A store without Pathao renders nothing.
 */
export function PathaoLocationPicker({
  address,
  value,
  onChange,
  onLabel,
  initialConfidence = null,
  parseSignal = 0,
  disabled = false,
}: {
  address: string;
  value: PathaoLocation;
  onChange: (next: PathaoLocation, label: string) => void;
  /** The current value spelled out ("Dhaka / Uttara Sector 10"), whenever
   *  the lists needed to spell it have loaded. For review prompts. */
  onLabel?: (label: string) => void;
  /** What the server already knows about this address, for the status line. */
  initialConfidence?: PathaoConfidence | null;
  /** Increment to parse the current address now (e.g. on textarea blur). */
  parseSignal?: number;
  disabled?: boolean;
}) {
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [cities, setCities] = React.useState<PathaoPlace[]>([]);
  const [zones, setZones] = React.useState<PathaoPlace[]>([]);
  const [areas, setAreas] = React.useState<PathaoPlace[]>([]);
  const [zonesLoading, setZonesLoading] = React.useState(false);
  const [areasLoading, setAreasLoading] = React.useState(false);
  const [parsing, setParsing] = React.useState(false);
  // What the last parse said, or what the server had said before; null
  // until either happened.
  const [confidence, setConfidence] = React.useState<PathaoConfidence | null>(
    initialConfidence
  );
  // "Pathao could not place the last address it was asked about."
  const [missed, setMissed] = React.useState(false);
  // Staff changed a dropdown: automatic parses keep their hands off.
  const [touched, setTouched] = React.useState(initialConfidence === "manual");
  // The address the last parse ran for, so re-renders never re-ask, and the
  // address the form opened with is not parsed again (the server did that).
  const lastParsed = React.useRef(address);
  const requestNo = React.useRef(0);

  // The server's verdict can arrive after mount (the modal parses the saved
  // address on opening); follow it, and keep the parser away from a location
  // staff chose.
  React.useEffect(() => {
    if (initialConfidence === null) return;
    setConfidence(initialConfidence);
    if (initialConfidence === "manual") setTouched(true);
  }, [initialConfidence]);

  React.useEffect(() => {
    let cancelled = false;
    listPathaoCities()
      .then((list) => {
        if (cancelled) return;
        setCities(list);
        setAvailable(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // 503: no Pathao credentials on this store — the picker has no
        // purpose. Anything else is a hiccup; keep the box, empty.
        setAvailable(!(err instanceof ApiError && err.status === 503));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (value.cityId === null) {
      setZones([]);
      return;
    }
    let cancelled = false;
    setZonesLoading(true);
    listPathaoZones(value.cityId)
      .then((list) => !cancelled && setZones(list))
      .catch(() => !cancelled && setZones([]))
      .finally(() => !cancelled && setZonesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [value.cityId]);

  React.useEffect(() => {
    if (value.zoneId === null) {
      setAreas([]);
      return;
    }
    let cancelled = false;
    setAreasLoading(true);
    listPathaoAreas(value.zoneId)
      .then((list) => !cancelled && setAreas(list))
      .catch(() => !cancelled && setAreas([]))
      .finally(() => !cancelled && setAreasLoading(false));
    return () => {
      cancelled = true;
    };
  }, [value.zoneId]);

  const parse = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      lastParsed.current = text;
      if (trimmed.length < MIN_ADDRESS_CHARS) return;
      const no = ++requestNo.current;
      setParsing(true);
      try {
        const result = await parseAddress(trimmed);
        // A slower answer for an older address must not land on a newer one.
        if (no !== requestNo.current) return;
        if (result.matched) {
          setMissed(false);
          setConfidence(result.confidence);
          onChange(
            { cityId: result.cityId, zoneId: result.zoneId, areaId: result.areaId },
            [result.cityName, result.zoneName, result.areaName].filter(Boolean).join(" / ")
          );
        } else {
          // Whatever was filled in was for a different address; leaving it
          // would book the parcel to the wrong place without anyone noticing.
          setMissed(true);
          setConfidence(null);
          onChange(EMPTY_LOCATION, "");
        }
      } catch {
        if (no === requestNo.current) setMissed(true);
      } finally {
        if (no === requestNo.current) setParsing(false);
      }
    },
    [onChange]
  );

  // Debounced parse as the address is typed — unless staff have taken over.
  React.useEffect(() => {
    if (!available || touched || disabled || address === lastParsed.current) return;
    const timer = setTimeout(() => void parse(address), PARSE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [address, available, touched, disabled, parse]);

  // Immediate parse when the parent says so (textarea blur).
  React.useEffect(() => {
    if (parseSignal === 0 || !available || touched || disabled) return;
    if (address !== lastParsed.current) void parse(address);
  }, [parseSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const labelFor = React.useCallback(
    (next: PathaoLocation) =>
      [
        cities.find((c) => c.id === next.cityId)?.name,
        zones.find((z) => z.id === next.zoneId)?.name,
        areas.find((a) => a.id === next.areaId)?.name,
      ]
        .filter(Boolean)
        .join(" / "),
    [cities, zones, areas]
  );

  React.useEffect(() => {
    onLabel?.(labelFor(value));
  }, [value, labelFor, onLabel]);

  if (available === false) return null;

  const choose = (next: PathaoLocation) => {
    setTouched(true);
    setConfidence("manual");
    setMissed(false);
    onChange(next, labelFor(next));
  };

  const reparse = () => {
    setTouched(false);
    lastParsed.current = "";
    void parse(address);
  };

  const clear = () => {
    setTouched(true);
    setConfidence(null);
    setMissed(false);
    onChange(EMPTY_LOCATION, "");
  };

  const filledByParser = !touched && confidence !== null && confidence !== "manual";
  const hasLocation = value.cityId !== null;

  return (
    <div className="rounded-xl border border-emerald-500/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          এড্রেস লিখলে এই ফিল্ডগুলা অটোমেটিক ফিল হবে। যদি না হয় তাহলে সিলেক্ট করে নিন।
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {parsing && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Ask Pathao again about this address"
            aria-label="Re-parse address"
            disabled={disabled || parsing || address.trim().length < MIN_ADDRESS_CHARS}
            onClick={reparse}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Clear city, zone and area"
            aria-label="Clear location"
            disabled={disabled || !hasLocation}
            onClick={clear}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>City</Label>
          <SearchSelect
            aria-label="City"
            value={value.cityId}
            options={cities}
            placeholder="Select a city"
            disabled={disabled}
            loading={available === null}
            highlighted={filledByParser && value.cityId !== null}
            onChange={(id) => choose({ cityId: id, zoneId: null, areaId: null })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Zone</Label>
          <SearchSelect
            aria-label="Zone"
            value={value.zoneId}
            options={zones}
            placeholder="Select a zone"
            disabled={disabled || value.cityId === null}
            loading={zonesLoading}
            highlighted={filledByParser && value.zoneId !== null}
            onChange={(id) => choose({ ...value, zoneId: id, areaId: null })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>
            Area <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <SearchSelect
            aria-label="Area"
            value={value.areaId}
            options={areas}
            placeholder="Select an area"
            disabled={disabled || value.zoneId === null}
            loading={areasLoading}
            highlighted={filledByParser && value.areaId !== null}
            onChange={(id) => choose({ ...value, areaId: id })}
          />
        </div>
      </div>

      <StatusLine confidence={confidence} missed={missed} hasLocation={hasLocation} />
    </div>
  );
}

function StatusLine({
  confidence,
  missed,
  hasLocation,
}: {
  confidence: PathaoConfidence | null;
  missed: boolean;
  hasLocation: boolean;
}) {
  let text: React.ReactNode = null;
  let tone = "text-muted-foreground";
  if (confidence === "manual" && hasLocation) {
    text = "Picked by staff.";
  } else if (confidence === "high" && hasLocation) {
    tone = "text-emerald-600 dark:text-emerald-400";
    text = (
      <>
        <Check className="mr-1 inline size-3.5" />
        Pathao matched this address.
      </>
    );
  } else if ((confidence === "medium" || confidence === "low") && hasLocation) {
    tone = "text-amber-600 dark:text-amber-400";
    text = "Pathao is not sure — please confirm the zone.";
  } else if (missed || (confidence !== null && !hasLocation)) {
    text = "Pathao could not place this address — select the city and zone.";
  }
  if (!text) return null;
  return <p className={cn("mt-2 text-xs", tone)}>{text}</p>;
}
