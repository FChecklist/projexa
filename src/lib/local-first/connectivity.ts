// LOCAL-FIRST connectivity: ONE answer to "can this laptop reach our servers right now?" (owner order 2026-10-02: PROJEXA
// keeps working with no internet, and with internet but OUR server down; "no error dialogs for being offline").
//
//   'online'       the browser has a network and our sync service / Supabase answer
//   'offline'      the browser itself says it has no network
//   'server_down'  the browser is online but our sync Edge Function / Supabase calls failed or timed out N times in a row
//
// The three look the same to the person: a tiny, calm marker "Working on this laptop; will sync when connected". The app
// never shows an error dialog for any of them; everything keeps working from the laptop's own copy.
//
// NO POLLING STORM. While the state is 'online' nothing is scheduled and nothing is sent. While 'offline' nothing is sent (the
// browser's own `online` event wakes it). Only while 'server_down' does it probe, and then at most ONE probe per 30 s, the gap
// doubling after every failed probe (30 s, 60 s, 120 s ... capped at 10 min) and resetting when the server answers. However many
// calls report failures, at most one probe is ever pending.
//
// WHO FEEDS IT. Anything that talks to the sync service or Supabase reports what happened: reportServerFailure() / reportServerSuccess(),
// or simply uses withConnectivityReporting(fetch), which does it from the answer (a thrown fetch, a timeout, a 5xx = failure; any
// other HTTP answer, even a 401 or 404, means the server is up). The release client does; so does the Supabase auth wrapper.
//
// Everything with a side effect is injected, so the state machine is tested with a fake clock and a fake probe.

import { useSyncExternalStore } from "react";
import { SYNC_BASE_URL } from "./sync-client";

export type Connectivity = "online" | "offline" | "server_down";

export type TimerHandle = unknown;

export type ConnectivityOptions = {
  /** The browser's own idea of having a network (navigator.onLine). */
  isOnline: () => boolean;
  /** One cheap request to our server. Resolves true when it answered (any status below 500), false when it failed or timed out. Never throws. */
  probe: (signal: AbortSignal) => Promise<boolean>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** Subscribes to the browser's online/offline events; returns the unsubscribe. */
  listenToBrowser?: (onChange: () => void) => () => void;
  /** Consecutive failures before 'server_down'. */
  failureThreshold?: number;
  /** The shortest gap between two probes while down. */
  minProbeIntervalMs?: number;
  /** The longest gap. */
  maxProbeIntervalMs?: number;
  probeTimeoutMs?: number;
};

export type ConnectivityController = {
  get(): Connectivity;
  subscribe(listener: (state: Connectivity) => void): () => void;
  /** A call to our server failed (network, timeout, 5xx). */
  reportFailure(): void;
  /** A call to our server was answered. */
  reportSuccess(): void;
  /** Starts listening to the browser. Idempotent. */
  start(): void;
  stop(): void;
  /** For tests and diagnostics. */
  debug(): { failures: number; probePending: boolean; probes: number; nextDelayMs: number };
};

export function createConnectivity(options: ConnectivityOptions): ConnectivityController {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const threshold = options.failureThreshold ?? 3;
  const minGap = options.minProbeIntervalMs ?? 30_000;
  const maxGap = options.maxProbeIntervalMs ?? 10 * 60_000;
  const probeTimeout = options.probeTimeoutMs ?? 5_000;

  let failures = 0;
  let timer: TimerHandle | null = null;
  let probing = false;
  let probes = 0;
  let lastProbeAt = Number.NEGATIVE_INFINITY;
  let downSince: number | null = null; // when this outage was noticed: its first probe comes minGap later, not at once
  let gap = minGap; // the wait before the next probe after a failed one
  let current: Connectivity = compute();
  let stopListening: (() => void) | null = null;
  const listeners = new Set<(state: Connectivity) => void>();

  function compute(): Connectivity {
    if (!options.isOnline()) return "offline";
    return failures >= threshold ? "server_down" : "online";
  }

  function refresh() {
    const next = compute();
    if (next === "server_down" && downSince === null) downSince = now();
    if (next === "online") downSince = null;
    if (next !== current) {
      current = next;
      for (const listener of [...listeners]) {
        try {
          listener(next);
        } catch {
          /* one listener's bug must not stop the others */
        }
      }
    }
    // A probe exists only while the browser is online and the server looks down: never while up, never while offline.
    if (next === "server_down") scheduleProbe();
    else cancelProbe();
  }

  function cancelProbe() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function scheduleProbe() {
    if (timer !== null || probing) return; // at most one pending probe, however many failures are reported
    // Never sooner than `gap` after the last probe, and never sooner than minGap after the outage was first noticed.
    const wait = Math.max(0, lastProbeAt + gap - now(), (downSince ?? now()) + minGap - now());
    timer = setTimer(() => {
      timer = null;
      void runProbe();
    }, wait);
  }

  async function runProbe() {
    if (compute() !== "server_down" || probing) return;
    probing = true;
    probes += 1;
    lastProbeAt = now();
    const controller = new AbortController();
    const abort = setTimer(() => controller.abort(), probeTimeout);
    let answered = false;
    try {
      answered = await options.probe(controller.signal);
    } catch {
      answered = false;
    } finally {
      clearTimer(abort);
      probing = false;
    }
    if (answered) {
      failures = 0;
      gap = minGap;
    } else {
      gap = Math.min(gap * 2, maxGap);
    }
    refresh();
  }

  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reportFailure() {
      // With no network of its own the browser explains the failure; it says nothing about our server. Only an online browser
      // that cannot reach us counts.
      if (!options.isOnline()) return;
      failures += 1;
      refresh();
    },
    reportSuccess() {
      if (failures === 0 && current !== "server_down") return;
      failures = 0;
      gap = minGap;
      refresh();
    },
    start() {
      if (stopListening) return;
      stopListening = options.listenToBrowser ? options.listenToBrowser(() => refresh()) : () => {};
      refresh();
    },
    stop() {
      stopListening?.();
      stopListening = null;
      cancelProbe();
    },
    debug: () => ({ failures, probePending: timer !== null, probes, nextDelayMs: gap }),
  };
}

// ─── the browser's real wiring ──────────────────────────────────────────────────────────────────────

/** Is this answer proof that the server is UP? Any HTTP answer below 500 is (a 401 or 404 still came from a running server). */
export function answerMeansServerUp(status: number): boolean {
  return status < 500;
}

/**
 * The default probe: a cheap GET of the sync service's /release/current. It sends no credentials and needs none to be answered by a
 * server that is up (a 401 is an answer). Resolves false on a thrown fetch, a timeout or a 5xx.
 */
export function createDefaultProbe(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): ConnectivityOptions["probe"] {
  const base = (options.baseUrl ?? SYNC_BASE_URL).replace(/\/+$/, "");
  return async (signal) => {
    try {
      const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
      const res = await doFetch(`${base}/release/current`, { method: "GET", cache: "no-store", credentials: "omit", signal });
      return answerMeansServerUp(res.status);
    } catch {
      return false;
    }
  };
}

/** Wraps a fetch so every answer (or failure) is reported to the connectivity state without the caller doing anything. */
export function withConnectivityReporting(fetchImpl: typeof fetch, controller: Pick<ConnectivityController, "reportFailure" | "reportSuccess">): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const res = await fetchImpl(input, init);
      if (answerMeansServerUp(res.status)) controller.reportSuccess();
      else controller.reportFailure();
      return res;
    } catch (err) {
      // A thrown fetch is a network failure or a timeout (a caller's own timeout aborts the request). Either counts once; it takes
      // several in a row to change the state and one answer to clear them, so an occasional cancelled request changes nothing.
      controller.reportFailure();
      throw err;
    }
  }) as typeof fetch;
}

let shared: ConnectivityController | null = null;

function browserListener(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The one controller of this tab. Created on first use; on the server it just says 'online' and never starts anything. */
export function sharedConnectivity(): ConnectivityController {
  if (!shared) {
    shared = createConnectivity({
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      probe: createDefaultProbe(),
      listenToBrowser: browserListener,
    });
    if (typeof window !== "undefined") shared.start();
  }
  return shared;
}

/** The single source of truth. */
export function getConnectivity(): Connectivity {
  return sharedConnectivity().get();
}

export function subscribe(listener: (state: Connectivity) => void): () => void {
  return sharedConnectivity().subscribe(listener);
}

export function reportServerFailure(): void {
  sharedConnectivity().reportFailure();
}

export function reportServerSuccess(): void {
  sharedConnectivity().reportSuccess();
}

/** React hook over the same state. `controller` is for tests; the default is the tab's shared one. */
export function useConnectivity(controller?: Pick<ConnectivityController, "get" | "subscribe">): Connectivity {
  const source = controller ?? sharedConnectivity();
  return useSyncExternalStore(
    (onChange) => source.subscribe(() => onChange()),
    () => source.get(),
    () => "online" as Connectivity
  );
}

/** What the calm marker says for 'offline' and for 'server_down'. The person is told one true thing, not a diagnosis. */
export const WORKING_LOCALLY_TEXT = "Working on this laptop; will sync when connected";
