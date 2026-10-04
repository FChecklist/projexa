// LOCAL-FIRST (Audit 37, point 33): "if something is not working, the error comes to us". Until now only the prepare run reported; a sync,
// outbox, offline, peer or screen error stayed on the laptop. This captures window errors and unhandled rejections (and lets any code call
// reportClientError) and sends a small, data-free line to this site's /api/local-first/client-error (one greppable runtime-log line).
// A report that cannot be sent (offline, signed out) is kept in localStorage (max 20) and sent with the next one / when back online.

export const ERR_PENDING_KEY = "px-client-errors-pending";
const MAX_PENDING = 20;
const MAX_PER_MINUTE = 5;

export type ClientErrorReport = { kind: string; message: string; where: string | null; at: string };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Deps = { send: (r: ClientErrorReport[]) => Promise<boolean>; storage?: StorageLike | null; now?: () => number };

export function createClientErrorReporter(deps: Deps) {
  const now = deps.now ?? Date.now;
  let sentAt: number[] = [];
  const load = (): ClientErrorReport[] => {
    try { return JSON.parse(deps.storage?.getItem(ERR_PENDING_KEY) ?? "[]") as ClientErrorReport[]; } catch { return []; }
  };
  const save = (l: ClientErrorReport[]) => {
    try {
      if (l.length) deps.storage?.setItem(ERR_PENDING_KEY, JSON.stringify(l.slice(-MAX_PENDING)));
      else deps.storage?.removeItem(ERR_PENDING_KEY);
    } catch { /* storage blocked */ }
  };
  async function flush(): Promise<void> {
    const list = load();
    if (!list.length) return;
    let ok = false;
    try { ok = await deps.send(list); } catch { ok = false; }
    if (ok) save([]);
  }
  async function report(kind: string, err: unknown, where?: string): Promise<void> {
    const t = now();
    sentAt = sentAt.filter((x) => t - x < 60_000);
    if (sentAt.length >= MAX_PER_MINUTE) return; // a render loop must not become a flood
    sentAt.push(t);
    const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
    save([...load(), { kind: kind.slice(0, 40), message, where: where?.slice(0, 120) ?? null, at: new Date(t).toISOString() }]);
    await flush();
  }
  return { report, flush };
}

let singleton: ReturnType<typeof createClientErrorReporter> | null = null;
function shared() {
  if (typeof window === "undefined") return null;
  singleton ??= createClientErrorReporter({
    storage: window.localStorage,
    send: async (reports) => {
      const res = await fetch("/api/local-first/client-error", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reports }), keepalive: true,
      });
      return res.ok;
    },
  });
  return singleton;
}

/** For any code that catches an error it would otherwise swallow (sync, outbox, peer, offline). Never throws. */
export function reportClientError(kind: string, err: unknown, where?: string): void {
  try { void shared()?.report(kind, err, where).catch(() => {}); } catch { /* reporting must never break the app */ }
}

/** Installs the global listeners once. Returns an uninstall function. */
export function installClientErrorReporting(): () => void {
  const s = shared();
  if (!s) return () => {};
  const onError = (e: ErrorEvent) => reportClientError("window_error", e.error ?? e.message, e.filename ? `${e.filename}:${e.lineno}` : undefined);
  const onRejection = (e: PromiseRejectionEvent) => reportClientError("unhandled_rejection", e.reason);
  const onOnline = () => { void s.flush().catch(() => {}); };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", onOnline);
  void s.flush().catch(() => {});
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", onOnline);
  };
}
