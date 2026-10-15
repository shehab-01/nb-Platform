"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDown, SearchIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchSelectOption<T extends number | string = number> = {
  id: T;
  name: string;
  /** Small muted text after the name (a unit, say); not searched. */
  hint?: string;
};

/**
 * A select with a search box, for lists too long to scroll — Pathao has 64
 * cities and thousands of zones. Built on the popover rather than the native
 * select, which has no filtering. Opening it puts the cursor in the search
 * box; typing narrows the list; Enter picks the first match; Escape closes.
 * An optional `action` row stays under the list whatever is typed ("New
 * item…"), so a missing entry is one click from being made.
 */
export function SearchSelect<T extends number | string = number>({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  loading = false,
  highlighted = false,
  action,
  className,
  "aria-label": ariaLabel,
}: {
  value: T | null;
  options: SearchSelectOption<T>[];
  onChange: (id: T) => void;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  /** Tinted, to show the value was filled in for the person, not by them. */
  highlighted?: boolean;
  /** A row below the options that runs `onSelect` instead of picking. */
  action?: { label: React.ReactNode; onSelect: () => void };
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const selected = options.find((option) => option.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((option) => option.name.toLowerCase().includes(q))
    : options;

  const pick = (id: T) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          // After the popover has mounted, so the search box has focus and
          // the person can type straight away.
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
            highlighted && "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40",
            className
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? (
              <>
                {selected.name}
                {selected.hint && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{selected.hint}</span>
                )}
              </>
            ) : loading ? (
              "Loading…"
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-56 gap-0 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered.length > 0) {
                e.preventDefault();
                pick(filtered[0].id);
              }
            }}
            placeholder="Search…"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : options.length === 0 ? "Nothing to choose from" : "No match"}
            </li>
          ) : (
            filtered.map((option) => (
              <li
                key={option.id}
                role="option"
                aria-selected={option.id === value}
                onClick={() => pick(option.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                  option.id === value && "font-medium"
                )}
              >
                <CheckIcon
                  className={cn("size-4 shrink-0", option.id === value ? "opacity-100" : "opacity-0")}
                />
                <span className="truncate">{option.name}</span>
                {option.hint && (
                  <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                )}
              </li>
            ))
          )}
        </ul>
        {action && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              action.onSelect();
            }}
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-primary hover:bg-accent"
          >
            {action.label}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
