"use client";

// R67 F-19 (audit recommendation R-245) -- how a create form loads the lists
// its dropdowns need.
//
// WHAT IT REPLACES. Every create client had its own version of
//
//     useEffect(() => {
//       fetch("/api/vendors").then(r => r.json()).then(d => setVendors(d.vendors ?? []))
//         .catch(() => { /* the dropdown is a convenience */ });
//     }, []);
//
// which has three faults the audit measured. (1) The status is never read, so
// a 500 arrives as an empty dropdown -- the user sees a select with nothing in
// it and no way to know whether that means "no subcontractors exist" or "the
// lookup failed". (2) The catch is empty, so the failure is invisible to
// everyone including the logs. (3) Nothing distinguishes "still loading" from
// "loaded, and there are none", so the placeholder lies for the first second.
//
// So a lookup now has three honest states and says which one it is in:
//   loading -> the select's placeholder reads "Loading <label>…"
//   ready   -> the options render
//   error   -> "Couldn't load <label> — Retry" beside the field, and, when the
//              field is REQUIRED, a reason inside the primary button so the
//              user is not left clicking a Save that cannot work.
//
// Every fetch carries an AbortController and is dropped on unmount, so a form
// the user backed out of does not set state or hold a connection.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { isAbortError } from "@/lib/module-list-state";

export type LookupStatus = "loading" | "ready" | "error";

/**
 * What the select shows before anything is chosen, for each state.
 *
 * Pure and exported so the exact wording is testable: "Loading
 * subcontractors…" is the difference between a dropdown that looks empty and
 * one that says it is still working.
 */
export function lookupPlaceholder(status: LookupStatus, label: string): string {
  if (status === "loading") return `Loading ${label}…`;
  if (status === "error") return `Couldn't load ${label}`;
  return `Select ${label}`;
}

export type Lookup<T> = {
  options: T[];
  status: LookupStatus;
  /** The select's placeholder for the current state. */
  placeholder: string;
  /** Re-issue the request (the Retry beside the field). */
  retry: () => void;
  /** The label, so the error component does not have to be passed it twice. */
  label: string;
};

export function useLookup<T>({
  url,
  pick,
  label,
}: {
  url: string;
  pick: (payload: Record<string, unknown>) => T[] | undefined;
  /** What the user calls this list: "subcontractors", "tasks", "task types". */
  label: string;
}): Lookup<T> {
  const [options, setOptions] = useState<T[]>([]);
  const [status, setStatus] = useState<LookupStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  // Synced in an effect, never during render (react-hooks/refs). Declared
  // before the fetch effect so it is current before any fetch reads it.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    void (async () => {
      try {
        const payload = await fetchJson<Record<string, unknown>>(url, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setOptions(pickRef.current(payload) ?? []);
        setStatus("ready");
      } catch (err) {
        // A cancellation is not a failure: the user left the form.
        if (isAbortError(err, controller.signal)) return;
        console.error(`[lookup] ${label} failed:`, err instanceof Error ? err.message : err);
        setOptions([]);
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [url, label, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    options,
    status,
    placeholder: lookupPlaceholder(status, label),
    retry,
    label,
  };
}

/** The reason to put in the primary button when a REQUIRED lookup failed. */
export function requiredLookupFailure(lookup: Lookup<unknown>, noun: string): string | null {
  return lookup.status === "error" ? `${noun} failed to load` : null;
}
