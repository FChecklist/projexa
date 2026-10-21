// WHAT WAS TYPED SURVIVES A SIGN-IN THAT RAN OUT. When a person's sign-in ends while a page (or a long form) is open -- it expired, or they signed out
// in another tab -- the page they were on, and what they had typed on it, must come back after they sign in again. A screen that keeps its own
// draft (use-draft.ts) already does. This is the safety net for EVERY other form: just before the person leaves for /login, the visible form values
// of the page are copied to sessionStorage under the page's address; when the same address opens again after sign-in, empty fields are filled back in
// (once) and the person is told so.
//
// Rules, all deliberate:
//   - passwords, files, hidden fields, one-time codes and anything marked data-px-no-snapshot are NEVER copied;
//   - a snapshot is kept for 2 hours, only for this tab (sessionStorage), and is TAKEN (removed) the moment it is used;
//   - only fields that are still EMPTY (or still at their first value) are filled, so a restore can never overwrite what the person typed afterwards;
//   - writes go through the browser's own value setter plus input/change events, so React forms and plain forms both see the change.
// Pure over a Document-like root + a Storage-like object so every rule is unit-tested without a browser.

export const SNAPSHOT_PREFIX = "px-form-snapshot:";
export const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_FIELDS = 200;
const MAX_VALUE_LENGTH = 20_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Snapshot = { savedAt: number; reason: string; fields: Record<string, string> };

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SKIP_TYPES = new Set(["password", "file", "hidden", "button", "submit", "reset", "image"]);

function skipped(el: FieldEl): boolean {
  if (el.closest("[data-px-no-snapshot]")) return true;
  if (el instanceof HTMLInputElement) {
    if (SKIP_TYPES.has((el.type || "text").toLowerCase())) return true;
    if ((el.getAttribute("autocomplete") ?? "").toLowerCase().includes("one-time-code")) return true;
  }
  return el.disabled || ("readOnly" in el && el.readOnly === true);
}

function textOfLabel(el: FieldEl): string {
  const id = el.getAttribute("id");
  const doc = el.ownerDocument;
  if (id) {
    const lab = doc.querySelector(`label[for="${id.replace(/["\\]/g, "\\$&")}"]`);
    if (lab?.textContent?.trim()) return lab.textContent.trim();
  }
  const wrap = el.closest("label");
  return wrap?.textContent?.trim() ?? "";
}

/** A stable name for a field: its id, name, test id, aria-label or label text. Several fields with the same name get "#2", "#3" in page order. */
function nameOf(el: FieldEl): string {
  const id = el.getAttribute("id");
  // React's generated ids (":r4:") change from one load to the next, so they are not a name.
  const stableId = id && !/^[:«]/.test(id) && !/^radix-/.test(id) ? id : "";
  return stableId || el.getAttribute("name") || el.getAttribute("data-testid") || el.getAttribute("aria-label") || textOfLabel(el) || "";
}

function keyed(root: ParentNode): { key: string; el: FieldEl }[] {
  const seen = new Map<string, number>();
  const out: { key: string; el: FieldEl }[] = [];
  root.querySelectorAll<FieldEl>("input, textarea, select").forEach((el) => {
    if (skipped(el)) return;
    const base = nameOf(el);
    if (!base) return;
    const type = el instanceof HTMLInputElement ? (el.type || "text").toLowerCase() : el.tagName.toLowerCase();
    const full = `${type}:${base}`;
    const n = (seen.get(full) ?? 0) + 1;
    seen.set(full, n);
    out.push({ key: n === 1 ? full : `${full}#${n}`, el });
  });
  return out;
}

function valueOf(el: FieldEl): string {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.checked ? "1" : "";
  return el.value ?? "";
}

/** The values currently typed on the page (non-empty only). */
export function collectFields(root: ParentNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, el } of keyed(root)) {
    const v = valueOf(el);
    if (v === "" || v.length > MAX_VALUE_LENGTH) continue;
    out[key] = v;
    if (Object.keys(out).length >= MAX_FIELDS) break;
  }
  return out;
}

function keyFor(url: string): string {
  return SNAPSHOT_PREFIX + url;
}

export function saveSnapshot(url: string, fields: Record<string, string>, reason: string, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): boolean {
  if (!storage || Object.keys(fields).length === 0) return false;
  try {
    const snap: Snapshot = { savedAt: now, reason, fields };
    storage.setItem(keyFor(url), JSON.stringify(snap));
    return true;
  } catch {
    return false; // storage full or blocked: the person simply types it again
  }
}

/** Reads without removing (used to decide whether to show the "putting back" note). */
export function peekSnapshot(url: string, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): Snapshot | null {
  try {
    const raw = storage?.getItem(keyFor(url));
    if (!raw) return null;
    const snap = JSON.parse(raw) as Partial<Snapshot>;
    if (typeof snap.savedAt !== "number" || now - snap.savedAt >= SNAPSHOT_TTL_MS || !snap.fields || typeof snap.fields !== "object") {
      storage?.removeItem(keyFor(url));
      return null;
    }
    return { savedAt: snap.savedAt, reason: String(snap.reason ?? ""), fields: snap.fields as Record<string, string> };
  } catch {
    return null;
  }
}

export function discardSnapshot(url: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(keyFor(url));
  } catch {
    /* ignore */
  }
}

function setNative(el: FieldEl, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/**
 * Puts the saved values back into the EMPTY fields of the page. Returns which keys were filled and which are still missing (the screen may still be
 * drawing them). Never overwrites a field that already holds something.
 */
export function applySnapshot(root: ParentNode, fields: Record<string, string>): { filled: string[]; missing: string[] } {
  const filled: string[] = [];
  const present = new Map(keyed(root).map((k) => [k.key, k.el] as const));
  for (const [key, value] of Object.entries(fields)) {
    const el = present.get(key);
    if (!el) continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (value && !el.checked) {
        el.click();
        filled.push(key);
      }
      continue;
    }
    if (valueOf(el) !== "") continue;
    if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === value)) continue;
    setNative(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    filled.push(key);
  }
  return { filled, missing: Object.keys(fields).filter((k) => !filled.includes(k) && !present.has(k)) };
}

/** The address a page lives at, as the snapshot key: path + query (no #fragment, no ?returnTo / ?focus markers). */
export function snapshotUrl(loc: { pathname: string; search: string }): string {
  const params = new URLSearchParams(loc.search);
  params.delete("returnTo");
  params.delete("focus");
  const q = params.toString();
  return `${loc.pathname}${q ? `?${q}` : ""}`;
}

/** Copies what is typed on THIS page, just before the person leaves for the sign-in page. Returns how many fields were kept. */
export function snapshotThisPage(reason: string, win: Pick<Window, "location" | "document"> | undefined = typeof window === "undefined" ? undefined : window, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): number {
  if (!win) return 0;
  try {
    const fields = collectFields(win.document);
    return saveSnapshot(snapshotUrl(win.location), fields, reason, storage, now) ? Object.keys(fields).length : 0;
  } catch {
    return 0;
  }
}
