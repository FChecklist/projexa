"use client";

// R67 lane D22 (item D-58, rec R-187): the control that ends "paste a known
// VERIDIAN user ID".
//
// An action item's owner is a real FK into VERIDIAN's compliance.users, so the
// old free-text box was a trap: a typo produced either a 500 or an action
// nobody owned, and the screen's own hint literally read `usr_abc123`. This
// searches the org directory server-side (/api/org/users?q=), shows people by
// name and email, and hands back the id -- which is never printed anywhere.
//
// Server-side search, not a full download filtered in the browser: an org's
// staff list is not a small fixed set, and the endpoint caps its own page.
import { useEffect, useRef, useState } from "react";
import SearchSelect, { type SearchSelectOption } from "@/components/SearchSelect";

export type OrgUser = { id: string; name: string; email: string; role: string };

const DEBOUNCE_MS = 200;

export default function OrgUserPicker({
  ariaLabel,
  value,
  onChange,
  className,
  placeholder = "Type a name…",
}: {
  ariaLabel: string;
  value: string | null;
  /** The chosen person, or null when cleared. The name is passed too so callers can show it without a second lookup. */
  onChange: (userId: string | null, user: OrgUser | null) => void;
  className?: string;
  placeholder?: string;
}) {
  const [options, setOptions] = useState<SearchSelectOption[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch(`/api/org/users?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("directory unavailable"))))
        .then((data: { users?: OrgUser[] }) => {
          if (cancelled) return;
          const list = data.users ?? [];
          setUsers(list);
          setOptions(list.map((u) => ({ value: u.id, label: u.name, sublabel: `${u.email} · ${u.role}` })));
          setFailed(false);
        })
        .catch(() => { if (!cancelled) { setOptions([]); setFailed(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  return (
    <div className={className}>
      <SearchSelect
        ariaLabel={ariaLabel}
        value={value}
        onChange={(id) => onChange(id, id ? users.find((u) => u.id === id) ?? null : null)}
        options={options}
        onQueryChange={setQuery}
        loading={loading}
        placeholder={placeholder}
        emptyText={failed ? "Couldn't load the people list" : "Nobody in your organisation matches"}
      />
    </div>
  );
}
