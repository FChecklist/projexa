// Records every call PROJEXA makes to its own API: a breadcrumb for each, an 'api_failure' error for each one that failed (HTTP >= 400, timeout,
// no network), and an 'action' for each write that went through. It never reads a request body, never reads a header it was not asked to
// (only the request id the server sends back), and it never changes what the caller sees: the Response is handed back untouched
// (the body is read from a CLONE, and only for a failure).

import { describeWrite, isBackgroundWrite } from "./plain-action";
import { scrubText } from "./redact";
import type { Capture } from "./capture";

/** Signals of requests the submit hook already reports as a named action ("Create Permit"), so the generic write line is not written twice. */
export const submitSignals = new WeakSet<object>();
export function markSubmitSignal(signal: AbortSignal): void {
  try {
    submitSignals.add(signal);
  } catch {
    /* ignore */
  }
}

export const EDGE_PATH_MARK = "/functions/v1/projexa-api";
const SELF_PATHS = ["/api/client-logs", "/api/local-first/client-error"];
const SLOW_ABORT_MS = 5_000;

export { describeWrite };

export type TrackedCall = { method: string; path: string };

/** The /api calls we follow: PROJEXA's own routes (same origin) and the same routes answered by the edge function. */
export function trackedCall(input: unknown, init: RequestInit | undefined, origin: string): TrackedCall | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url;
    if (!raw) return null;
    const u = new URL(raw, origin);
    let path = u.pathname;
    const edge = path.indexOf(EDGE_PATH_MARK);
    if (edge >= 0) path = path.slice(edge + EDGE_PATH_MARK.length);
    else if (u.origin !== new URL(origin).origin) return null;
    if (!path.startsWith("/api/")) return null;
    if (SELF_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null;
    const method = (init?.method ?? (typeof input === "object" && input && "method" in (input as Request) ? (input as Request).method : "GET") ?? "GET").toUpperCase();
    return { method, path: path.slice(0, 300) };
  } catch {
    return null;
  }
}

async function serverWords(res: Response): Promise<string> {
  try {
    const text = await res.clone().text();
    try {
      const j = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof j?.error === "string") return scrubText(j.error, 500);
      if (typeof j?.message === "string") return scrubText(j.message, 500);
    } catch {
      /* not JSON */
    }
    return scrubText(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 500);
  } catch {
    return "";
  }
}

export type FetchCaptureDeps = {
  capture: Capture;
  now?: () => number;
  origin: () => string;
  getProjectId: () => string | null;
  /** The browser's own word on whether it has a network. A request made while it says "no" is expected to fail and is not a problem. */
  isOnline?: () => boolean;
  /** True while the page is being closed or navigated away from: the browser cancels what is in flight, which is not a problem either. */
  isLeaving?: () => boolean;
};

/** Returns a fetch that behaves exactly like `original`, plus the capture described above. */
export function wrapFetch(original: typeof fetch, deps: FetchCaptureDeps): typeof fetch {
  const now = deps.now ?? Date.now;
  const wrapped = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let call: TrackedCall | null = null;
    try {
      call = trackedCall(input, init, deps.origin());
    } catch {
      call = null;
    }
    if (!call) return original(input, init);
    const started = now();
    const viaSubmit = !!(init?.signal && submitSignals.has(init.signal));
    const onlineNow = () => {
      try {
        return deps.isOnline ? deps.isOnline() : true;
      } catch {
        return true;
      }
    };
    const startedOffline = !onlineNow();
    const background = call.method !== "GET" && call.method !== "HEAD" && call.method !== "OPTIONS" && isBackgroundWrite(call.path);
    try {
      const res = await original(input, init);
      const ms = now() - started;
      try {
        deps.capture.crumb("api", `${call.method} ${call.path} ${res.status} ${ms}ms`);
        if (res.status >= 400) {
          const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-vercel-id") ?? res.headers.get("sb-request-id");
          void serverWords(res).then((words) =>
            deps.capture.captureError({
              kind: "api_failure",
              message: words ? `${call!.method} ${call!.path} failed (${res.status}): ${words}` : `${call!.method} ${call!.path} failed (${res.status})`,
              apiPath: call!.path,
              httpMethod: call!.method,
              httpStatus: res.status,
              requestId,
              durationMs: ms,
            })
          );
        }
        if (call.method !== "GET" && call.method !== "HEAD" && call.method !== "OPTIONS" && !viaSubmit && !background) {
          deps.capture.captureAction({
            actionName: describeWrite(call.method, call.path),
            outcome: res.status >= 400 ? "failed" : "ok",
            durationMs: ms,
            apiPath: call.path,
            httpMethod: call.method,
            httpStatus: res.status,
          });
        }
      } catch {
        /* never let logging change the answer */
      }
      return res;
    } catch (err) {
      const ms = now() - started;
      try {
        const name = err instanceof Error ? err.name : "";
        const cancelled = name === "AbortError" && ms < SLOW_ABORT_MS; // the person (or the page) cancelled it: not a failure
        // No network (it said so when the call started, or says so now) or the page is going away: expected, not a problem to report.
        const expected = startedOffline || !onlineNow() || (deps.isLeaving ? deps.isLeaving() : false);
        deps.capture.crumb("api", `${call.method} ${call.path} ${cancelled ? "cancelled" : expected ? "not sent (offline)" : "failed"} ${ms}ms`);
        if (!cancelled && !expected) {
          const timedOut = name === "TimeoutError" || name === "AbortError";
          deps.capture.captureError({
            kind: "api_failure",
            message: timedOut
              ? `${call.method} ${call.path} did not answer in time (${Math.round(ms / 1000)} s)`
              : `${call.method} ${call.path} could not reach the server (network failure)`,
            apiPath: call.path,
            httpMethod: call.method,
            httpStatus: 0,
            durationMs: ms,
          });
          if (call.method !== "GET" && call.method !== "HEAD" && !viaSubmit && !background) {
            deps.capture.captureAction({ actionName: describeWrite(call.method, call.path), outcome: "failed", durationMs: ms, apiPath: call.path, httpMethod: call.method, httpStatus: 0 });
          }
        }
      } catch {
        /* ignore */
      }
      throw err;
    }
  };
  return wrapped as typeof fetch;
}

