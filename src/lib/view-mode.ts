"use client";

// Traditional View | Modern View -- Sumeet's "traditional UI/UX" request.
//
// TRADITIONAL: the left pane is split into two parts -- the upper two thirds
// is the module menu (the same grouped list the Home directory shows), the
// lower third is the chat box. MODERN: the shell as it was before this switch
// (left pane = Task Master / chat card, modules on the Home directory).
// TRADITIONAL IS THE DEFAULT (owner, 2026-10-09); a person can switch to Modern.
//
// The choice is a per-browser display preference, like the project preference:
// kept in localStorage only (no server round trip, works fully offline), and
// shared between the toggle and the shell through a small subscription so a
// click repaints the shell in the same tick.
import { useCallback, useSyncExternalStore } from "react";

export type ViewMode = "traditional" | "modern";

export const VIEW_MODE_KEY = "projexa.viewMode";
export const DEFAULT_VIEW_MODE: ViewMode = "traditional";

const listeners = new Set<() => void>();

export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw === "modern" ? "modern" : raw === "traditional" ? "traditional" : DEFAULT_VIEW_MODE;
}

export function readViewMode(): ViewMode {
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

export function writeViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* private window / blocked storage: the choice lasts until reload through the listeners below */
    memoryMode = mode;
  }
  listeners.forEach((l) => l());
}

let memoryMode: ViewMode | null = null;

function snapshot(): ViewMode {
  return memoryMode ?? readViewMode();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === VIEW_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** [mode, setMode]. Server render and first paint use the default, then the stored choice applies. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_VIEW_MODE);
  const set = useCallback((m: ViewMode) => writeViewMode(m), []);
  return [mode, set];
}
