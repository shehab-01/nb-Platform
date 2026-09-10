"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * A write-only field. The stored value never reaches the browser: the API
 * says only whether one is set and how it ends. Leaving the box empty keeps
 * it; typing replaces it; Clear removes it.
 *
 * `value` is undefined (keep), "" (clear) or the new text — the same
 * contract the API uses.
 */
export function SecretInput({
  id,
  isSet,
  hint,
  value,
  onChange,
}: {
  id: string;
  isSet: boolean;
  hint: string | null;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const clearing = value === "";
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type="password"
        autoComplete="off"
        disabled={clearing}
        placeholder={
          clearing
            ? "Will be removed on save"
            : isSet
              ? `Saved${hint ? ` · ends with ${hint}` : ""} — type to replace`
              : "Not set"
        }
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
      {isSet && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => onChange(clearing ? undefined : "")}
        >
          {clearing ? "Keep" : "Clear"}
        </Button>
      )}
    </div>
  );
}
