// LOCAL-FIRST browser AI: puts the API on the page as window.projexa.ai (requirement R11, the JavaScript door).
//
// The property cannot be swapped by a script in the page for one of its own: it is an accessor with NO setter and it is NOT configurable,
// so assignment, `delete` and Object.defineProperty all fail (lf-e11: it used to be a configurable value, and one
// Object.defineProperty(window, "projexa", ...) replaced PROJEXA's API with anything at all). What it returns is a frozen holder whose
// `ai` is read-only. Only PROJEXA can change what it returns -- through the closure below -- to take it down (sign-out) or to publish
// the next person's surface on the same page.
// Also dispatches a "projexa:ai-ready" event on the window, so an agent that loaded first can wait for it.

import type { ProjexaAi } from "./api";

export const AI_READY_EVENT = "projexa:ai-ready";

type Win = { projexa?: { ai?: ProjexaAi }; dispatchEvent?: (event: Event) => boolean };
type Slot = { holder: { ai?: ProjexaAi } | undefined };

/** The one slot per window that the non-configurable `projexa` getter reads. */
const slots = new WeakMap<object, Slot>();

function slotFor(win: Win): Slot | null {
  const existing = slots.get(win);
  if (existing) return existing;
  const slot: Slot = { holder: undefined };
  try {
    Object.defineProperty(win, "projexa", { get: () => slot.holder, enumerable: false, configurable: false });
  } catch {
    return null; // something else already owns window.projexa for good: PROJEXA does not publish over it
  }
  slots.set(win, slot);
  return slot;
}

export function publishAiSurface(win: Win, api: ProjexaAi): () => void {
  const holder: { ai?: ProjexaAi } = {};
  Object.defineProperty(holder, "ai", { value: api, enumerable: true, writable: false, configurable: false });
  Object.freeze(holder);
  const slot = slotFor(win);
  if (!slot) return () => {};
  slot.holder = holder;
  try {
    if (typeof win.dispatchEvent === "function" && typeof CustomEvent === "function") win.dispatchEvent(new CustomEvent(AI_READY_EVENT, { detail: { version: api.version } }));
  } catch { /* no event support: the property is still there */ }
  return () => {
    if (slot.holder === holder) slot.holder = undefined;
  };
}
