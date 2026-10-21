// THE WAY BACK. When a guided error sends a person somewhere else to correct something (a "Fix it now" link), the screen they leave is remembered
// here -- its full address, a label for it ("Back to your new project") and the key of the draft that holds what they typed -- so the destination
// screen can offer one tap back. A small stack in sessionStorage: at most 5 entries, each valid for 2 hours, surviving reloads, never required.
// Pure functions over a Storage-like object so every rule is unit-tested without a browser.

import { safeRedirectPath } from "@/lib/safe-redirect";
import { pathOf, withParam, withoutParam } from "./urls";

export const TRAIL_KEY = "px-return-trail";
export const TRAIL_MAX = 5;
export const TRAIL_TTL_MS = 2 * 60 * 60 * 1000;
/** How long after it was made a saved ("ready") entry keeps showing on the screens the person lands on next. */
export const FOLLOW_AFTER_SAVE_MS = 30 * 60 * 1000;
/** The query parameter that carries the trail entry's id on the destination URL. */
export const RETURN_PARAM = "returnTo";
/** Fired on window when a trail entry changes, so the strip updates without polling. */
export const TRAIL_EVENT = "px-return-trail-changed";

export type TrailEntry = {
  id: string;
  /** Where to go back to: the full path + query of the screen that was left. */
  returnUrl: string;
  label: string;
  createdAt: number;
  /** Key of the draft (use-draft.ts) holding what was typed there, if any. */
  draftKey?: string;
  /** The path of the screen the person was sent to; the strip is shown there. */
  destination: string;
  /** True once something was saved on the destination screen: the strip then says "You can go back now". */
  ready?: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function read(storage: StorageLike | null, now: number): TrailEntry[] {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(TRAIL_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is TrailEntry =>
        !!e && typeof e.id === "string" && typeof e.returnUrl === "string" && typeof e.label === "string" && typeof e.createdAt === "number" && typeof e.destination === "string" && now - e.createdAt < TRAIL_TTL_MS && now >= e.createdAt - 60_000
    );
  } catch {
    return [];
  }
}

function write(storage: StorageLike | null, list: TrailEntry[]): void {
  if (!storage) return;
  try {
    if (list.length) storage.setItem(TRAIL_KEY, JSON.stringify(list.slice(-TRAIL_MAX)));
    else storage.removeItem(TRAIL_KEY);
  } catch {
    /* storage blocked: the trail is a convenience, never a requirement */
  }
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(TRAIL_EVENT));
  } catch {
    /* ignore */
  }
}

let counter = 0;
export function newTrailId(now: number = Date.now()): string {
  counter += 1;
  return `r${now.toString(36)}${counter.toString(36)}`;
}

/** Remembers the screen being left. Returns the stored entry (its id goes on the destination URL). Oldest entries beyond 5 fall off. */
export function pushReturn(
  entry: { id?: string; returnUrl: string; label: string; destination: string; draftKey?: string },
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now()
): TrailEntry {
  const stored: TrailEntry = {
    id: entry.id ?? newTrailId(now),
    returnUrl: safeRedirectPath(entry.returnUrl, "/dashboard"),
    label: entry.label,
    createdAt: now,
    draftKey: entry.draftKey,
    destination: pathOf(entry.destination),
  };
  const list = read(storage, now).filter((e) => e.id !== stored.id);
  list.push(stored);
  write(storage, list);
  return stored;
}

export function listTrail(storage: StorageLike | null = defaultStorage(), now: number = Date.now()): TrailEntry[] {
  return read(storage, now);
}

/** The entry the strip should show on this screen: the one named by ?returnTo=, else the newest whose destination is this path. */
export function entryForScreen(pathname: string, search: string, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): TrailEntry | null {
  const list = read(storage, now);
  const wanted = new URLSearchParams(search).get(RETURN_PARAM);
  if (wanted) {
    const hit = list.find((e) => e.id === wanted);
    if (hit) return hit;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].destination === pathname) return list[i];
  // The person fixed the problem and SAVED on the destination screen, and the save moved them on (a create screen lands on the record it just
  // made: /materials/new -> /materials/<id>). The way back must follow them there, or it is lost at the exact moment it is needed. Only an
  // entry that was marked ready (a write succeeded on its destination) and is recent; "Stay here" or "Back" removes it.
  for (let i = list.length - 1; i >= 0; i--) if (list[i].ready && now - list[i].createdAt < FOLLOW_AFTER_SAVE_MS) return list[i];
  return null;
}

/** Takes the entry off the trail and returns it: called when the person goes back (or presses "Stay here"). */
export function consumeReturn(id: string, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): TrailEntry | null {
  const list = read(storage, now);
  const hit = list.find((e) => e.id === id) ?? null;
  if (hit) write(storage, list.filter((e) => e.id !== id));
  return hit;
}

/** Something was saved on the destination screen: the strip becomes the stronger "You can go back now". */
export function markReturnReady(pathname: string, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): void {
  if (!storage) return;
  const list = read(storage, now);
  let changed = false;
  for (const e of list) {
    if (e.destination === pathname && !e.ready) {
      e.ready = true;
      changed = true;
    }
  }
  if (changed) write(storage, list);
}

/** The destination URL carries the entry's id, so the strip survives a reload and a copy of the link on this device. */
export function withReturnTo(url: string, id: string): string {
  return withParam(url, RETURN_PARAM, id);
}

/** Where "Back" goes: the stored address, without the ?returnTo / ?focus markers, and only ever a same-origin path. */
export function backUrl(entry: TrailEntry): string {
  return withoutParam(withoutParam(safeRedirectPath(entry.returnUrl, "/dashboard"), RETURN_PARAM), "focus");
}
