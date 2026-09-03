"use client";

// R67 D-80 (audit R-302) -- "pickers that cost one click".
//
// THE DEFECT. Mark Attendance (Worker), Record Receipt (Material) and Log Time
// (Task) each open with an empty required Select, every single time. A site
// clerk marking one worker, a storekeeper receiving the same cement all week
// and a designer logging hours to the same activity all pay a click they have
// already paid. Worse, a roster of one still asks: the field offers exactly one
// possible answer and refuses to fill it in.
//
// THREE BEHAVIOURS, and nothing else:
//
//  1. A LIST OF ONE IS ALREADY ANSWERED. When there is exactly one option it is
//     selected and displayed on arrival.
//  2. THE LAST CHOICE IS OFFERED BACK. Remembered per user, project and picker
//     in localStorage (src/lib/last-choice.ts, every access guarded), and only
//     applied when that option is STILL in the list -- a worker who left the
//     roster is not silently re-selected.
//  3. TYPING COUNTS ONCE. The field filters as you type and Enter takes the
//     highlighted option, so a typed name is one typed value, not a type-then-
//     hunt-then-click.
//
// WHY THIS IS NOT THE shadcn/Radix Select. Radix's Select is not a combobox: it
// has no text input, so "type to filter, Enter to take" cannot be expressed in
// it at all. This is a plain input + listbox with the ARIA combobox roles, which
// is also why it is keyboard-complete without a third-party dependency.
//
// The preselection is reported to the parent through onChange on mount, so the
// Save label's own field count reflects it IMMEDIATELY -- a button that still
// says "Save (Worker, Date)" over a field that is visibly filled in is worse
// than no preselection at all.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type ComboboxOption = { value: string; label: string; hint?: string };

/**
 * Exported for the sibling test. This environment does not deliver input/change
 * events to React (measured -- see MaterialIssueCreateClient.test.tsx's header),
 * so the rules that depend on a typed value are pure functions tested directly
 * rather than through the DOM.
 *
 * Matching is case-insensitive and substring, over the label AND the hint, so
 * "mas" finds "Masood Alam" and "OPC" finds a material whose spec carries it.
 */
export function filterOptions(options: readonly ComboboxOption[], query: string): ComboboxOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(needle));
}

/**
 * Where the highlight lands. Wraps at both ends, because a list you cannot get
 * back to the top of is a list you have to reach for the mouse to use. An empty
 * list has no highlight at all (-1), never index 0 of nothing.
 */
export function nextHighlight(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/**
 * D-80's preselection rule, in one place so the three screens cannot drift.
 *
 * Order matters: a value the user has already chosen in this session wins over
 * everything; a list of exactly one answers itself; otherwise the remembered
 * choice is offered back, but ONLY if it is still a real option.
 */
export function resolveInitialValue(
  options: readonly ComboboxOption[],
  currentValue: string,
  storedValue: string | null
): string {
  if (currentValue) return currentValue;
  if (options.length === 1) return options[0].value;
  if (storedValue && options.some((o) => o.value === storedValue)) return storedValue;
  return "";
}

export default function EntityCombobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  disabled = false,
  emptyMessage = "No match",
  /** null while the list is still loading -- the field says so instead of looking empty. */
  loading = false,
  /** D-80: the remembered choice for this picker, resolved by the caller from last-choice.ts. */
  storedValue = null,
  /** Fired when focus leaves the field, so a caller can mark it touched for blur validation. */
  onBlur,
  "aria-label": ariaLabel,
}: {
  id?: string;
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyMessage?: string;
  loading?: boolean;
  storedValue?: string | null;
  onBlur?: () => void;
  "aria-label"?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  // The preselection must run once per option list, not on every render, or a
  // user who deliberately cleared the field would have it refilled under them.
  const preselectedFor = useRef<string | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const visible = useMemo(() => filterOptions(options, query), [options, query]);

  useEffect(() => {
    if (loading || options.length === 0) return;
    const signature = options.map((o) => o.value).join("|");
    if (preselectedFor.current === signature) return;
    preselectedFor.current = signature;
    const resolved = resolveInitialValue(options, value, storedValue);
    // Reported up even though it is not a click, so the Save label's field
    // count is correct on the first paint rather than after the first keystroke.
    if (resolved && resolved !== value) onChange(resolved);
  }, [loading, options, storedValue, value, onChange]);

  const commit = useCallback((option: ComboboxOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    setHighlight(-1);
  }, [onChange]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => nextHighlight(h, visible.length, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter") {
      // Enter takes the highlighted option; with no highlight it takes the TOP
      // MATCH, but only when something was actually typed. That distinction is
      // the whole rule: "type 'mas', press Enter" is one typed value and no
      // clicks (D-80's own acceptance), whereas Enter on an untouched, unfiltered
      // list would be the picker guessing -- it would silently select whichever
      // row happened to sort first, which is how a wrong worker gets a day's pay.
      const target = highlight >= 0 ? visible[highlight] : query.trim() ? visible[0] ?? null : null;
      if (target) {
        event.preventDefault();
        commit(target);
      }
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  }

  return (
    <div className="relative">
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled || loading}
        placeholder={loading ? "Loading…" : selected ? selected.label : placeholder}
        value={open ? query : selected ? selected.label : query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        // A blur that is not a selection must not discard the selection itself,
        // only the half-typed query.
        onBlur={() => { setOpen(false); setQuery(""); setHighlight(-1); onBlur?.(); }}
        onKeyDown={onKeyDown}
      />
      {open && !loading && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-ct-border2 bg-background py-1 shadow-card"
        >
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-px-muted">{emptyMessage}</li>
          ) : (
            visible.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-[13px] ${
                    index === highlight ? "bg-px-cloud" : ""
                  }`}
                  // onMouseDown, not onClick: the input's blur fires first and
                  // would close the list before a click could land.
                  onMouseDown={(event) => { event.preventDefault(); commit(option); }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span>{option.label}</span>
                  {option.hint ? <span className="text-[11px] text-px-muted">{option.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
