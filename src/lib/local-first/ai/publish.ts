// LOCAL-FIRST browser AI: puts the API on the page as window.projexa.ai (requirement R11, the JavaScript door).
//
// The property is defined read-only (writable: false), so a script in the page cannot silently swap PROJEXA's API for
// one of its own. It stays configurable only so PROJEXA itself can take it down again (sign-out, another person).
// Also dispatches a "projexa:ai-ready" event on the window, so an agent that loaded first can wait for it.

import type { ProjexaAi } from "./api";

export const AI_READY_EVENT = "projexa:ai-ready";

type Win = { projexa?: { ai?: ProjexaAi }; dispatchEvent?: (event: Event) => boolean };

export function publishAiSurface(win: Win, api: ProjexaAi): () => void {
  const holder: { ai?: ProjexaAi } = {};
  Object.defineProperty(holder, "ai", { value: api, enumerable: true, writable: false, configurable: false });
  Object.freeze(holder);
  Object.defineProperty(win, "projexa", { value: holder, enumerable: false, writable: false, configurable: true });
  try {
    if (typeof win.dispatchEvent === "function" && typeof CustomEvent === "function") win.dispatchEvent(new CustomEvent(AI_READY_EVENT, { detail: { version: api.version } }));
  } catch { /* no event support: the property is still there */ }
  return () => {
    if (win.projexa === holder) delete (win as { projexa?: unknown }).projexa;
  };
}
