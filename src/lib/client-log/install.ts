// Browser wiring for the device log. Installed once per page (idempotent). Runs on the person's own device; the only thing that ever
// leaves it is the redacted event rows sent through the outbox to /api/client-logs.
//
// Everything is wrapped: a failure here must never be seen by the person. If the browser lacks something (IndexedDB, sendBeacon, crypto)
// the feature degrades quietly instead of throwing.

import { createCapture, type Capture } from "./capture";
import { wrapFetch } from "./fetch-capture";
import { createBestStore, createOutbox, type Outbox } from "./outbox";
import { readSelectedProjectId } from "@/lib/project-cookie";
import { scrubText } from "./redact";
import type { ClientLogContext, ClientLogEvent, SendResult } from "./types";

const ENDPOINT = "/api/client-logs";
// Pages where nobody is signed in: capture still keeps what happens, but nothing is sent (the server would only answer 401).
const SIGNED_OUT_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/how-it-works", "/invite", "/share", "/shared", "/auth", "/contact", "/pricing", "/terms", "/privacy"];

type Installed = { capture: Capture; outbox: Outbox; uninstall: () => void };
let installed: Installed | null = null;
// Errors already reported as render errors: the console line React/our boundary prints for the same Error is not a second problem.
const reported = new WeakSet<object>();

export function isSignedOutPath(pathname: string): boolean {
  return pathname === "/" || SIGNED_OUT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
  }
}

function sessionId(): string {
  try {
    const k = "px-client-log-session";
    const have = sessionStorage.getItem(k);
    if (have) return have;
    const id = newId();
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return newId();
  }
}

function currentProjectId(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("projectId");
    if (fromUrl) return fromUrl;
    return readSelectedProjectId();
  } catch {
    return null;
  }
}

function deviceContext(): ClientLogContext {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    userAgent: (nav?.userAgent ?? "").slice(0, 300),
    platform: ((nav as unknown as { userAgentData?: { platform?: string } })?.userAgentData?.platform ?? nav?.platform ?? "").slice(0, 60),
    screen: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}` : "",
    language: nav?.language ?? "",
    online: nav?.onLine ?? true,
    appVersion: (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown").slice(0, 40),
  };
}

function labelOf(el: Element): string {
  const own = el.getAttribute("aria-label") || el.getAttribute("title");
  // The visible words of a button or link -- never the value of a field. For <input type=submit|button> the value IS its caption.
  const text =
    own ||
    (el instanceof HTMLInputElement ? el.value : (el.textContent ?? "")) ||
    el.getAttribute("data-testid") ||
    el.id ||
    el.tagName.toLowerCase();
  return text.replace(/\s+/g, " ").trim().slice(0, 60);
}

export function installClientLog(): () => void {
  if (typeof window === "undefined") return () => {};
  if (installed) return installed.uninstall;
  try {
    const win = window;
    const sid = sessionId();
    const prevFetch = win.fetch;
    const originalFetch = prevFetch.bind(win);

    const send = async (events: ClientLogEvent[]): Promise<SendResult> => {
      const res = await originalFetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }), keepalive: events.length < 20 });
      let body: { accepted?: number; rejected?: { index: number; reason: string }[] } = {};
      if (res.ok) body = await res.json().catch(() => ({}));
      const ra = Number(res.headers.get("retry-after"));
      return { status: res.status, accepted: body.accepted, rejected: body.rejected, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined };
    };

    const outbox = createOutbox({
      store: createBestStore(win),
      send,
      isOnline: () => navigator.onLine !== false,
      canSend: () => !isSignedOutPath(win.location.pathname),
    });
    const capture = createCapture(
      { now: Date.now, newId, sessionId: sid, getRoute: () => win.location.pathname, getProjectId: currentProjectId, getContext: deviceContext },
      outbox
    );

    // 1) uncaught errors and unhandled promise failures
    const onError = (e: ErrorEvent) => {
      // A failing <img>/<script> fires "error" on the element (no .error / .message): not an app error.
      if (!e.error && !e.message) return;
      capture.captureError({ kind: "error", message: e.error ?? e.message, stack: e.error instanceof Error ? e.error.stack : null });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      capture.captureError({ kind: "unhandled_rejection", message: r instanceof Error ? r : (typeof r === "string" ? r : safeJson(r)), stack: r instanceof Error ? r.stack : null });
    };
    win.addEventListener("error", onError);
    win.addEventListener("unhandledrejection", onRejection);

    // 2) every failed /api call + every write
    let leaving = false;
    const onLeave = () => { leaving = true; };
    const onBack = () => { leaving = false; };
    win.addEventListener("pagehide", onLeave);
    win.addEventListener("beforeunload", onLeave);
    win.addEventListener("pageshow", onBack);
    const wrapped = wrapFetch(originalFetch, { capture, origin: () => win.location.origin, getProjectId: currentProjectId, isOnline: () => win.navigator.onLine !== false, isLeaving: () => leaving });
    win.fetch = wrapped;

    // 3) console.error as a warning-level line (React and our own code log real problems there). Never re-enters itself.
    const originalConsoleError = console.error;
    let inConsole = false;
    console.error = function (...args: unknown[]) {
      if (!inConsole) {
        inConsole = true;
        try {
          const err = args.find((a) => a instanceof Error) as Error | undefined;
          if (err && reported.has(err)) return originalConsoleError.apply(console, args as []);
          capture.captureError({ kind: "error", severity: "warning", message: args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safeJson(a))).join(" ").slice(0, 1000), stack: err?.stack ?? null });
        } catch {
          /* ignore */
        } finally {
          inConsole = false;
        }
      }
      return originalConsoleError.apply(console, args as []);
    };

    // 4) what the person did: clicks on buttons/links (their words, never typed values), form submits, screen changes
    const onClick = (e: MouseEvent) => {
      try {
        const t = e.target;
        if (!(t instanceof Element)) return;
        const el = t.closest("button, a[href], [role='button'], [role='tab'], [role='menuitem'], input[type='submit'], input[type='button']");
        if (el) capture.crumb("click", labelOf(el));
      } catch {
        /* ignore */
      }
    };
    const onSubmit = (e: Event) => {
      try {
        const f = e.target;
        if (f instanceof HTMLFormElement) capture.crumb("submit", f.getAttribute("aria-label") || f.getAttribute("data-testid") || f.getAttribute("name") || f.id || "form");
      } catch {
        /* ignore */
      }
    };
    win.document.addEventListener("click", onClick, true);
    win.document.addEventListener("submit", onSubmit, true);

    let lastRoute = win.location.pathname;
    const noteRoute = () => {
      const r = win.location.pathname;
      if (r !== lastRoute) {
        lastRoute = r;
        capture.crumb("nav", `Opened ${r}`, r);
      }
    };
    const history = win.history;
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = function (...a: Parameters<History["pushState"]>) {
      const out = push.apply(this, a);
      noteRoute();
      return out;
    };
    history.replaceState = function (...a: Parameters<History["replaceState"]>) {
      const out = replace.apply(this, a);
      noteRoute();
      return out;
    };
    win.addEventListener("popstate", noteRoute);
    capture.crumb("nav", `Opened ${lastRoute}`, lastRoute);

    // 5) delivery: back online -> now; page hidden -> hand the waiting batch to the browser's beacon
    const onOnline = () => outbox.resume();
    const onHide = () => {
      if (win.document.visibilityState !== "hidden") return;
      outbox.flushOnHide((events) => {
        try {
          const blob = new Blob([JSON.stringify({ events })], { type: "application/json" });
          return typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, blob);
        } catch {
          return false;
        }
      });
    };
    win.addEventListener("online", onOnline);
    win.document.addEventListener("visibilitychange", onHide);
    win.addEventListener("pagehide", onHide);

    const uninstall = () => {
      win.removeEventListener("error", onError);
      win.removeEventListener("unhandledrejection", onRejection);
      win.removeEventListener("online", onOnline);
      win.removeEventListener("popstate", noteRoute);
      win.removeEventListener("pagehide", onHide);
      win.removeEventListener("pagehide", onLeave);
      win.removeEventListener("beforeunload", onLeave);
      win.removeEventListener("pageshow", onBack);
      win.document.removeEventListener("visibilitychange", onHide);
      win.document.removeEventListener("click", onClick, true);
      win.document.removeEventListener("submit", onSubmit, true);
      if (win.fetch === wrapped) win.fetch = prevFetch;
      if (console.error !== originalConsoleError) console.error = originalConsoleError;
      if (history.pushState !== push) history.pushState = push;
      if (history.replaceState !== replace) history.replaceState = replace;
      installed = null;
    };
    installed = { capture, outbox, uninstall };
    return uninstall;
  } catch {
    return () => {};
  }
}

function safeJson(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return "[unprintable]";
  }
}

function ensure(): Installed | null {
  // An error boundary's effect can run before the root component's, so install on first use -- but never implicitly under the test runner
  // (it would patch the global fetch of an unrelated test); tests that want it call installClientLog() themselves.
  if (!installed && process.env.NODE_ENV !== "test") installClientLog();
  return installed;
}

// ---- the small public surface other code uses; every function is a no-op until installed, and none can throw ----

/** An error the app caught itself and would otherwise swallow (sync, outbox, peer, offline ...). */
export function logClientError(kind: string, err: unknown, where?: string): void {
  try {
    ensure()?.capture.captureError({ kind: "error", message: `${kind}: ${err instanceof Error ? `${err.name}: ${err.message}` : scrubText(err, 400)}${where ? ` (${where})` : ""}`, stack: err instanceof Error ? err.stack : null });
  } catch {
    /* ignore */
  }
}

/** A React render error (error.tsx / global-error.tsx call this). */
export function logRenderError(error: Error & { digest?: string }, where?: string): void {
  try {
    reported.add(error);
    ensure()?.capture.captureError({ kind: "render_error", message: `${error.name}: ${error.message}${error.digest ? ` [${error.digest}]` : ""}${where ? ` (${where})` : ""}`, stack: error.stack ?? null });
  } catch {
    /* ignore */
  }
}

/** An important write: create / save / approve / delete / export / upload. */
export function logAction(actionName: string, outcome: "ok" | "failed", durationMs?: number | null): void {
  try {
    ensure()?.capture.captureAction({ actionName, outcome, durationMs: durationMs ?? null });
  } catch {
    /* ignore */
  }
}

/**
 * Like logAction, but NEVER installs the log: if nothing has installed it yet this does nothing. For callers on the first-load / workspace
 * prepare path (the outbox), which must not patch fetch, open a database or add listeners as a side effect of reporting.
 */
export function logActionIfInstalled(actionName: string, outcome: "ok" | "failed", durationMs?: number | null): void {
  try {
    installed?.capture.captureAction({ actionName, outcome, durationMs: durationMs ?? null });
  } catch {
    /* ignore */
  }
}

/** Tells the outbox the person is signed in again: sending resumes. */
export function resumeClientLog(): void {
  try {
    ensure()?.outbox.resume();
  } catch {
    /* ignore */
  }
}

export function __clientLogForTest(): Installed | null {
  return installed;
}
