"use client";

// R67 lane D22 (items D-58 and D-64) -- ONE searchable picker for this app.
//
// WHY IT EXISTS: two audit findings turn out to be the same missing control.
// R-187 asked for a people picker so nobody types "usr_abc123" into an action
// item's owner box; R-230 asked for a BOQ line picker so nobody scrolls a
// native <select> of hundreds of lines looking for "R60SK-A". Both need the
// same thing: type to narrow, see a second line of context under each option,
// and be able to show an option that exists but cannot be chosen (a parent BOQ
// line, a deactivated user) WITH the reason, rather than hiding it.
//
// Deliberately hand-rolled over Input + a listbox rather than cmdk's Command:
// the option list here is frequently server-filtered (onQueryChange debounced
// against an endpoint), and cmdk owns its own filtering, so the two fight over
// which list is authoritative. This component never filters what a server
// filtered -- see `filterLocally`.
//
// The chosen value is stored as the option's `value` (an id) and NEVER
// rendered: the input shows `label`, which is what the audit asked for.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Second line under the label -- unit + remaining qty, an email, a role. */
  sublabel?: string;
  /** Rendered, but not choosable. Always paired with disabledReason. */
  disabled?: boolean;
  /** Said out loud next to the option, never only as a tooltip. */
  disabledReason?: string;
};

export type SearchSelectProps = {
  /** Accessible name for the control. */
  ariaLabel: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  /** Shown when the (already filtered) option list is empty. */
  emptyText?: string;
  /**
   * When given, typing is reported here instead of being applied locally --
   * the caller is doing the search server-side and hands back a new `options`.
   */
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Pure: the options a typed query should leave visible when filtering happens locally. */
export function filterLocally(options: SearchSelectOption[], query: string): SearchSelectOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (o) => o.label.toLowerCase().includes(needle) || (o.sublabel ?? "").toLowerCase().includes(needle)
  );
}

export default function SearchSelect({
  ariaLabel,
  value,
  onChange,
  options,
  placeholder = "Type to search…",
  emptyText = "Nothing matches",
  onQueryChange,
  loading = false,
  disabled = false,
  className,
}: SearchSelectProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  // A server-filtered list is authoritative: filtering it again locally would
  // hide rows the server deliberately returned (a fuzzy or code-prefix match
  // the client's plain substring test would miss).
  const visible = useMemo(
    () => (onQueryChange ? options : filterLocally(options, query)),
    [onQueryChange, options, query]
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => { setActive(0); }, [visible.length]);

  function commit(option: SearchSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (visible.length === 0 ? 0 : (i + step + visible.length) % visible.length));
      return;
    }
    if (event.key === "Enter") {
      const option = visible[active];
      if (open && option) { event.preventDefault(); commit(option); }
      return;
    }
    if (event.key === "Escape") { setOpen(false); }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <div className="flex items-center gap-1 rounded-md border border-px-border2 bg-white px-2 focus-within:border-px-steel">
        <input
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          className="w-full bg-transparent py-1.5 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : (selected?.label ?? "")}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            onQueryChange?.(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {selected && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${ariaLabel}`}
            className="shrink-0 px-1 text-[12px] text-px-muted hover:text-px-ink"
            onClick={() => { onChange(null); setQuery(""); }}
          >
            ✕
          </button>
        )}
        <ChevronsUpDown className="size-3.5 shrink-0 text-px-muted" aria-hidden="true" />
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-px-border2 bg-white py-1 shadow-lg"
        >
          {loading && <li className="px-3 py-2 text-[12.5px] text-px-muted">Searching…</li>}
          {!loading && visible.length === 0 && <li className="px-3 py-2 text-[12.5px] text-px-muted">{emptyText}</li>}
          {!loading && visible.map((option, i) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(option)}
                className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-[13px] ${
                  option.disabled ? "cursor-not-allowed text-px-muted" : i === active ? "bg-px-cloud" : ""
                }`}
              >
                <Check className={`mt-0.5 size-3.5 shrink-0 ${option.value === value ? "" : "invisible"}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.sublabel && <span className="block truncate text-[11.5px] text-px-muted">{option.sublabel}</span>}
                  {option.disabled && option.disabledReason && (
                    <span className="block text-[11.5px] text-px-muted">{option.disabledReason}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
