// BROWSER AND DEVICE CHECK (guided errors, group G4). Looks at the browser by READING PROPERTIES ONLY -- no database is opened, nothing is fetched,
// no service worker is registered -- so it costs nothing at first load and can run anywhere (the static-host and "new machine" tests require zero
// work at first load). The one tiny write it does (a 1-byte key in localStorage, removed at once) is how a blocked or full store is told apart from
// a working one; it only runs on the sign-in page, never in the laptop shell's boot.
//
// Each problem is a CODE that the guide catalogue explains in full (src/lib/error-guide/catalogue/g4-session-laptop.ts):
//   BROWSER_COOKIES_BLOCKED   cookies are off: the sign-in cannot be kept
//   BROWSER_STORAGE_BLOCKED   site data is blocked (private mode, a privacy setting)
//   STORAGE_FULL              the store is full
//   BROWSER_NO_INDEXEDDB      no local database: the laptop copy cannot be used
//   BROWSER_TOO_OLD           missing features PROJEXA needs

export type BrowserProblem = { code: "BROWSER_COOKIES_BLOCKED" | "BROWSER_STORAGE_BLOCKED" | "STORAGE_FULL" | "BROWSER_NO_INDEXEDDB" | "BROWSER_TOO_OLD"; detail?: string };

/** The parts of `window` this check reads, so a test can hand in a fake. */
export type BrowserLike = {
  navigator?: { cookieEnabled?: boolean };
  localStorage?: Pick<Storage, "setItem" | "removeItem">;
  indexedDB?: unknown;
  fetch?: unknown;
  Promise?: unknown;
  URLSearchParams?: unknown;
};

const PROBE_KEY = "px-probe";

function storageState(win: BrowserLike): "ok" | "blocked" | "full" {
  let store: Pick<Storage, "setItem" | "removeItem"> | undefined;
  try {
    store = win.localStorage; // a blocked store throws on the property access itself
  } catch {
    return "blocked";
  }
  if (!store) return "blocked";
  try {
    store.setItem(PROBE_KEY, "1");
    store.removeItem(PROBE_KEY);
    return "ok";
  } catch (err) {
    const name = err && typeof err === "object" ? String((err as { name?: unknown }).name ?? "") : "";
    return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" ? "full" : "blocked";
  }
}

/** Everything wrong with this browser that PROJEXA can name, most serious first. An empty list means nothing to report. */
export function diagnoseBrowser(win: BrowserLike | undefined): BrowserProblem[] {
  if (!win) return [];
  const out: BrowserProblem[] = [];
  const missing = (["fetch", "Promise", "URLSearchParams"] as const).filter((k) => typeof (win as Record<string, unknown>)[k] === "undefined");
  if (missing.length) out.push({ code: "BROWSER_TOO_OLD", detail: missing.join(", ") });
  if (win.navigator && win.navigator.cookieEnabled === false) out.push({ code: "BROWSER_COOKIES_BLOCKED" });
  const store = storageState(win);
  if (store === "blocked") out.push({ code: "BROWSER_STORAGE_BLOCKED" });
  else if (store === "full") out.push({ code: "STORAGE_FULL", detail: "The browser refused to save even one small value." });
  if (!win.indexedDB) out.push({ code: "BROWSER_NO_INDEXEDDB" });
  return out;
}

/** A failure to open the local database (IndexedDB.open's error), as the guide code and the words to fill in. */
export function indexedDbFailure(err: unknown): { code: "INDEXEDDB_BLOCKED" | "STORAGE_FULL"; detail: string } {
  const name = err && typeof err === "object" ? String((err as { name?: unknown }).name ?? "") : "";
  const message = err instanceof Error ? err.message : "";
  if (name === "QuotaExceededError") return { code: "STORAGE_FULL", detail: "The browser has no space left for the laptop copy." };
  return { code: "INDEXEDDB_BLOCKED", detail: message ? `The browser said: ${message}` : "The browser did not say why." };
}
