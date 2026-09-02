"use client";

// R67 F-21 (audit recommendation R-236) -- the session store behind the shell.
//
// THE MEASURED PROBLEM. M24Shell issued its organisation, projects,
// notifications, pill-ranking and capability-tree reads on EVERY navigation,
// pushing network-idle to 3.8-4.6 s on screens that needed none of them. Those
// six answers are session-scoped: the user's organisation is the same on
// /permits as on /scope.
//
// THE RULE THIS FILE IMPLEMENTS. Read from the store; go to the network only
// when a key is genuinely stale, and do it in the BACKGROUND, never behind a
// spinner over data that is already on screen:
//
//     organisation, projects, pill ranking   5 minutes
//     notifications                          1 minute
//     capability tree, currencies            24 hours
//
// A write invalidates only what it affects -- creating a project invalidates
// `projects`, sending a task invalidates `pillUsage` -- so the shell is
// correct without re-reading everything.
//
// It is a module-level cache with a subscriber set rather than a React context
// on purpose: the store must survive a remount of the shell (a hard route
// change, a fast refresh) and be readable from a write handler that is not
// inside the provider. The staleness maths is pure and exported so it can be
// tested without a DOM.

import { useCallback, useEffect, useState } from "react";
import type { ShellBootstrapPayload } from "@/app/api/shell/route";

export type ShellKey =
  | "organization"
  | "projects"
  | "notifications"
  | "pillUsage"
  | "capabilityTree"
  | "currencies"
  | "vendors";

export const SHELL_FRESHNESS_MS: Record<ShellKey, number> = {
  organization: 5 * 60_000,
  projects: 5 * 60_000,
  notifications: 60_000,
  pillUsage: 5 * 60_000,
  capabilityTree: 24 * 60 * 60_000,
  currencies: 24 * 60 * 60_000,
  // R67 F-25 (R-241): the subcontractor list changes when someone adds a
  // vendor, which is rare but not never -- ten minutes, matching the
  // Cache-Control: private, max-age=600 on /api/vendors itself.
  vendors: 10 * 60_000,
};

export type ShellSnapshot = {
  data: ShellBootstrapPayload | null;
  /** When each key was last explicitly invalidated by a write. */
  invalidatedAt: Partial<Record<ShellKey, number>>;
};

/**
 * Does this snapshot need a background revalidation?
 *
 * True when any key's own freshness window has elapsed since the fetch, or a
 * write invalidated a key AFTER the data was fetched. Pure, so the policy is
 * testable without mounting anything.
 */
export function shellNeedsRevalidation(snapshot: ShellSnapshot, now: number): boolean {
  if (!snapshot.data) return true;
  const { fetchedAt } = snapshot.data;
  for (const key of Object.keys(SHELL_FRESHNESS_MS) as ShellKey[]) {
    if (now - fetchedAt >= SHELL_FRESHNESS_MS[key]) return true;
    const invalidated = snapshot.invalidatedAt[key];
    if (invalidated !== undefined && invalidated > fetchedAt) return true;
  }
  return false;
}

/** The keys that are stale right now, for logging and for tests. */
export function staleShellKeys(snapshot: ShellSnapshot, now: number): ShellKey[] {
  if (!snapshot.data) return Object.keys(SHELL_FRESHNESS_MS) as ShellKey[];
  const { fetchedAt } = snapshot.data;
  return (Object.keys(SHELL_FRESHNESS_MS) as ShellKey[]).filter((key) => {
    if (now - fetchedAt >= SHELL_FRESHNESS_MS[key]) return true;
    const invalidated = snapshot.invalidatedAt[key];
    return invalidated !== undefined && invalidated > fetchedAt;
  });
}

// ---------------------------------------------------------------------------
// The store itself.
// ---------------------------------------------------------------------------

let snapshot: ShellSnapshot = { data: null, invalidatedAt: {} };
let inFlight: Promise<void> | null = null;
let lastFailureAt = 0;
const listeners = new Set<() => void>();

// A failed bootstrap leaves the snapshot stale, and "stale" is exactly what
// triggers a refetch -- so without a cooldown a backend that is down would be
// hammered in a tight loop for as long as the tab is open. Thirty seconds is
// long enough to stop the loop and short enough that a recovered backend is
// picked up without a reload.
export const SHELL_FAILURE_COOLDOWN_MS = 30_000;

function emit() {
  for (const listener of listeners) listener();
}

/** Test seam: drop everything (used by the store's own suite). */
export function resetShellStore(): void {
  snapshot = { data: null, invalidatedAt: {} };
  inFlight = null;
  lastFailureAt = 0;
}

export function getShellSnapshot(): ShellSnapshot {
  return snapshot;
}

/**
 * The subcontractor list IF the bootstrap has already answered, otherwise null.
 *
 * A PASSIVE read: it never subscribes and never triggers a fetch, so a create
 * form can seed its own lookup from a warm session store without undoing F-19's
 * rule that the shell bootstrap stays off a create route's critical path.
 */
export function getShellVendors(): { id: string; vendorName: string }[] | null {
  const vendors = snapshot.data?.vendors;
  return vendors && vendors.length > 0 ? vendors : null;
}

/**
 * Mark keys as needing a refresh after a write. The next read revalidates in
 * the background; nothing is cleared, so the screen keeps showing the last
 * known-good answer rather than flashing empty.
 */
export function invalidateShell(...keys: ShellKey[]): void {
  const now = Date.now();
  const next = { ...snapshot.invalidatedAt };
  for (const key of keys) next[key] = now;
  snapshot = { ...snapshot, invalidatedAt: next };
  emit();
}

async function fetchBootstrap(): Promise<void> {
  const res = await fetch("/api/shell");
  // Status before body: an error body parses perfectly well as JSON, and
  // treating it as data is how a failed request becomes a confident shell.
  const body = (await res.json().catch(() => null)) as ShellBootstrapPayload | { error?: string } | null;
  if (!res.ok || !body || !("fetchedAt" in body)) {
    const message =
      body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Couldn't load the shell (HTTP ${res.status})`;
    lastFailureAt = Date.now();
    // The last known-good data is KEPT: a failed revalidation must not blank a
    // shell that is already correct on screen. When there is none, an empty
    // shell carrying the real reason is recorded so the UI can say what broke
    // instead of rendering an em-dash.
    snapshot = {
      data: snapshot.data ?? {
        organization: null,
        role: null,
        email: null,
        projects: [],
        notifications: [],
        unreadCount: 0,
        pillUsage: [],
        history: [],
        isNewUser: false,
        capabilityTree: [],
        currencies: [],
        vendors: [],
        fetchedAt: Date.now(),
        errors: { shell: message },
      },
      invalidatedAt: snapshot.invalidatedAt,
    };
    emit();
    return;
  }
  // A successful fetch clears the invalidation marks it just answered.
  lastFailureAt = 0;
  snapshot = { data: body, invalidatedAt: {} };
  emit();
}

/**
 * Fetch once, sharing one request between every caller that asks at once.
 * Refuses to retry inside the failure cooldown unless forced (an explicit
 * user-initiated refresh).
 */
export function loadShell(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && lastFailureAt > 0 && Date.now() - lastFailureAt < SHELL_FAILURE_COOLDOWN_MS) {
    return Promise.resolve();
  }
  inFlight = fetchBootstrap().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * The shell's data, hydrated once per session and revalidated in the
 * background when a key goes stale.
 *
 * `enabled` false holds the fetch back entirely -- F-19 uses it to keep the
 * bootstrap off a create form's critical path until the browser is idle.
 */
export function useShell({ enabled = true }: { enabled?: boolean } = {}) {
  const [state, setState] = useState<ShellSnapshot>(snapshot);

  useEffect(() => {
    const listener = () => setState(snapshot);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!shellNeedsRevalidation(snapshot, Date.now())) return;
    void loadShell();
  }, [enabled, state.data, state.invalidatedAt]);

  // An explicit refresh is the one caller allowed past the failure cooldown --
  // the user asked, and telling them "not yet" would be the dead end the
  // Retry control exists to remove.
  const refresh = useCallback(() => {
    invalidateShell(...(Object.keys(SHELL_FRESHNESS_MS) as ShellKey[]));
    return loadShell(true);
  }, []);

  return {
    ...(state.data ?? {}),
    errors: state.data?.errors ?? {},
    loaded: state.data !== null,
    refresh,
  } as Partial<ShellBootstrapPayload> & { errors: Record<string, string>; loaded: boolean; refresh: () => Promise<void> };
}
