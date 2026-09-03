"use client";

// R67 lane I (WS-I item I-05, R-177): the labelled Category control on a BOQ
// line row, shared by ScopeCreateClient and ScopeReviseClient so the two can
// never drift into different behaviour for the same field.
//
// THREE RULES FROM THE ITEM, all visible in the markup below:
//   * it is LABELLED (this also closes the unlabelled-inputs finding for this
//     row -- a placeholder is not a label to a screen reader);
//   * "Add new" is inline -- a user typing a category the org has not
//     registered yet must not have to leave the form, lose their line items
//     and come back;
//   * a line with NO category is never blocked. It saves, and renders a
//     "no category" chip so the gap is visible instead of silent.
//
// A native <select> rather than the shadcn Select used elsewhere on this page:
// this control sits inside a dense, repeated line row where the free-text
// "Add new" option has to hand focus straight to a text input, and a native
// select gives that for free with real keyboard and screen-reader behaviour.
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NO_CATEGORY_CHIP_LABEL } from "@/lib/boq-helpers";

export type BoqCategory = { id: string; name: string; isActive: boolean };

const ADD_NEW_VALUE = "__add_new__";

/**
 * Loads the org's BOQ categories once per mounted screen. Returns the list, a
 * loading flag, and an `addLocal` so a category created inline on one line row
 * is immediately offered on every other row without a refetch.
 *
 * A load failure is NOT fatal and is NOT hidden: the select degrades to a
 * free-text input (see BoqCategorySelect below), because a broken category
 * list must never stop someone entering a BOQ.
 */
export function useBoqCategories() {
  const [categories, setCategories] = useState<BoqCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scope/categories")
      // R67 D-03 / D-71: the STATUS is read before the body. This chain used
      // to go straight to `.then((r) => r.json())` and infer failure from the
      // body's own shape (`d.error || !Array.isArray(d.categories)`), which
      // happens to catch what this route really sends but is a weaker test
      // than asking the server what it said -- a proxy 502 returning an HTML
      // page, or any 5xx whose body parses to something array-shaped, would
      // have arrived here as data. It is also the exact shape
      // src/lib/no-swallowed-http-errors.test.ts's third guard exists to stop.
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`scope/categories ${r.status}`))))
      .then((d: { categories?: BoqCategory[]; error?: string }) => {
        if (cancelled) return;
        if (d.error || !Array.isArray(d.categories)) { setFailed(true); return; }
        setCategories(d.categories);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function addLocal(name: string) {
    setCategories((prev) =>
      prev.some((c) => c.name.toLowerCase() === name.toLowerCase())
        ? prev
        : [...prev, { id: `local:${name.toLowerCase()}`, name, isActive: true }]
    );
  }

  return { categories, loading, failed, addLocal };
}

export default function BoqCategorySelect({
  value,
  categories,
  failed,
  onChange,
  onAddNew,
  showLabel = false,
  ariaLabel = "Category",
}: {
  value: string;
  categories: BoqCategory[];
  /** true when the category list could not be loaded -- the control becomes free text. */
  failed: boolean;
  onChange: (next: string) => void;
  /** Called when the user commits a brand-new category name; registers it org-wide. */
  onAddNew: (name: string) => void;
  /** Render the visible "Category" label. Shown on the first row only; every other row still gets an aria-label. */
  showLabel?: boolean;
  /**
   * R67 D-24: the accessible name, so a GRID of these can distinguish its rows
   * ("Line 2 Category"). "Category" alone is ambiguous the moment a screen
   * renders more than one, which is every BOQ with more than one line.
   */
  ariaLabel?: string;
}) {
  const id = useId();
  const [addingNew, setAddingNew] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingNew) newInputRef.current?.focus();
  }, [addingNew]);

  // A value the org's list does not contain (an imported category, or one
  // added on another row before this component remounted) must still be
  // SELECTED, not silently reset to blank -- so it is offered as its own
  // option rather than dropped.
  const known = categories.some((c) => c.name.toLowerCase() === value.trim().toLowerCase());
  const options = known || value.trim() === ""
    ? categories
    : [...categories, { id: `unlisted:${value}`, name: value.trim(), isActive: true }];

  function commitNew(raw: string) {
    const name = raw.trim();
    setAddingNew(false);
    if (!name) return;
    onAddNew(name);
    onChange(name);
  }

  if (failed || addingNew) {
    return (
      <div className="w-[150px] shrink-0">
        {showLabel && <label htmlFor={id} className="mb-1 block text-xs text-ct-muted">Category</label>}
        <Input
          id={id}
          ref={newInputRef}
          aria-label={ariaLabel}
          placeholder="Category"
          defaultValue={addingNew ? "" : value}
          onBlur={(e) => (addingNew ? commitNew(e.target.value) : onChange(e.target.value.trim()))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape" && addingNew) { setAddingNew(false); }
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-[150px] shrink-0">
      {showLabel && <label htmlFor={id} className="mb-1 block text-xs text-ct-muted">Category</label>}
      <select
        id={id}
        aria-label={ariaLabel}
        className="h-9 w-full rounded-md border border-ct-border bg-transparent px-2 text-sm"
        value={known || value.trim() === "" ? value : value.trim()}
        onChange={(e) => {
          if (e.target.value === ADD_NEW_VALUE) { setAddingNew(true); return; }
          onChange(e.target.value);
        }}
      >
        <option value="">{NO_CATEGORY_CHIP_LABEL}</option>
        {options.map((c) => (
          <option key={c.id} value={c.name}>{c.name}</option>
        ))}
        <option value={ADD_NEW_VALUE}>+ Add new…</option>
      </select>
    </div>
  );
}
