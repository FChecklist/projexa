"use client";

// R67 lane D22 (item D-64, rec R-230): the searchable BOQ line picker.
//
// WHAT IT REPLACES: a native <select> holding every line in the BOQ, labelled
// with the description alone, in insertion order. On a 128-line BOQ that is a
// scroll, not a choice -- and it gave no way to tell a parent line (whose
// quantity is delivered through its children and cannot be recorded against)
// from an ordinary one, so picking the wrong one was silent.
//
// Searched SERVER-SIDE against /api/scope/lines, matching both code and
// description, so the same lookup answers the form, the chat's record step and
// the reports. Parent lines are shown and disabled WITH the reason rather than
// hidden: a QS looking for a code they can see in their own BOQ must find it
// and be told why it is not selectable.
import { useEffect, useRef, useState } from "react";
import SearchSelect, { type SearchSelectOption } from "@/components/SearchSelect";
import { toSearchOptions, type BoqLineOption } from "@/lib/boq-line-options";

const DEBOUNCE_MS = 200;

export default function BoqLinePicker({
  projectId,
  boqId,
  value,
  onChange,
  ariaLabel = "BOQ line",
  className,
}: {
  projectId: string;
  /** Narrows the lookup to one BOQ; omitted, the server resolves the project's current one. */
  boqId?: string | null;
  value: string | null;
  onChange: (lineId: string | null, line: BoqLineOption | null) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [options, setOptions] = useState<SearchSelectOption[]>([]);
  const [lines, setLines] = useState<BoqLineOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams({ projectId });
      if (query) params.set("q", query);
      if (boqId) params.set("boqId", boqId);
      fetch(`/api/scope/lines?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("BOQ lines unavailable"))))
        .then((data: { lines?: BoqLineOption[] }) => {
          if (cancelled) return;
          const list = data.lines ?? [];
          setLines(list);
          setOptions(toSearchOptions(list));
          setFailed(false);
        })
        .catch(() => { if (!cancelled) { setOptions([]); setFailed(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [projectId, boqId, query]);

  return (
    <div className={className}>
      <SearchSelect
        ariaLabel={ariaLabel}
        value={value}
        onChange={(id) => onChange(id, id ? lines.find((l) => l.id === id) ?? null : null)}
        options={options}
        onQueryChange={setQuery}
        loading={loading}
        placeholder="Search by code or description…"
        emptyText={failed ? "Couldn't load this project's BOQ lines" : "No BOQ line matches"}
      />
    </div>
  );
}
