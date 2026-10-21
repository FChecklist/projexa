"use client";

// What a person typed must survive leaving the screen (a "Fix it now" link, a sign-in that ran out, a reload) and be there when they come back.
// This is the tiny, form-agnostic version: ONE object per form in sessionStorage, valid for 2 hours. (The laptop-first outbox keeps its own drafts
// of writes that did not reach the server -- src/lib/local-first/outbox-drafts.ts; this is for a form that has not been sent yet.)
//
//   const draft = useDraft("project-new", { name: "", description: "" });
//   draft.value.name / draft.set({ name: "x" }) / draft.clear() on a successful save / draft.restored tells the form it was filled for the person.
//
// Nothing is read or written until the form is on screen (no work at page load), and a blocked or full storage degrades to a plain in-memory form.

import { useCallback, useEffect, useRef, useState } from "react";

export const DRAFT_PREFIX = "px-draft:";
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): void {
  try {
    storage?.setItem(DRAFT_PREFIX + key, JSON.stringify({ savedAt: now, value }));
  } catch {
    /* storage blocked or full */
  }
}

export function loadDraft<T>(key: string, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): T | null {
  try {
    const raw = storage?.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; value?: T };
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt >= DRAFT_TTL_MS) {
      storage?.removeItem(DRAFT_PREFIX + key);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* ignore */
  }
}

export type UseDraft<T> = {
  value: T;
  /** Merge changes into the draft (and keep them). */
  set: (patch: Partial<T>) => void;
  /** Throw the draft away: after a successful save, or when the person chooses to start fresh. */
  clear: () => void;
  /** True when the form was filled from an earlier visit; shown to the person so a surprise is never silent. */
  restored: boolean;
  /** Start again from empty, keeping the screen. */
  startFresh: () => void;
};

export function useDraft<T extends Record<string, unknown>>(key: string, initial: T): UseDraft<T> {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    const saved = loadDraft<T>(key);
    if (saved && typeof saved === "object") {
      setValue({ ...initialRef.current, ...saved });
      setRestored(true);
    }
  }, [key]);

  const set = useCallback(
    (patch: Partial<T>) => {
      setValue((prev) => {
        const next = { ...prev, ...patch };
        saveDraft(key, next);
        return next;
      });
    },
    [key]
  );

  const clear = useCallback(() => clearDraft(key), [key]);

  const startFresh = useCallback(() => {
    clearDraft(key);
    setValue(initialRef.current);
    setRestored(false);
  }, [key]);

  return { value, set, clear, restored, startFresh };
}
