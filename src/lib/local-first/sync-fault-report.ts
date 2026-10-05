// AUDIT-100 B57 / B58 (error capture): "if something is not working, the error comes to us" for the background engines, not only window errors.
//
// client-error-report.ts already sends window errors and unhandled rejections. The engines that do the real work (the outbox that sends
// a person's edits, the replica that copies the server's data down, the laptop-to-laptop sync, the browser-AI tools) catch their own
// errors on purpose so a failure never reaches the screen -- which also meant it never reached us. They now call reportFault() from those
// catch blocks.
//
// What is NOT reported (it is normal, not a fault): the person being signed out, an app update being required, a request the engine
// itself cancelled, or any network failure while the browser says it is offline. Everything else is reported -- including timeouts and
// 5xx answers while online, which is how a slow or failing edge call (the old ~21 second stalls) becomes visible to us.
//
// One line per (where, message) every five minutes at most, on top of the reporter's own cap of 5 a minute, so a retry loop is one line.
import { reportClientError } from "./client-error-report";

export type FaultWhere = "outbox:push" | "outbox:pass" | "replica:sync" | "peer:sync" | "ai:tool";

/** SyncError kinds that are an expected state, not a fault (see sync-client.ts SyncErrorKind). Matched by name so this file imports nothing heavy. */
const EXPECTED_KINDS = new Set(["signed_out", "update_required", "aborted"]);
const REPEAT_WINDOW_MS = 5 * 60_000;

type Sink = (kind: string, err: unknown, where: string) => void;
let sink: Sink = (kind, err, where) => reportClientError(kind, err, where);
let clock: () => number = Date.now;
const lastSeen = new Map<string, number>();

/** Tests only: replaces where reports go and what time it is, and forgets what was already reported. */
export function configureFaultReportForTests(opts: { sink?: Sink; now?: () => number } = {}): void {
  sink = opts.sink ?? ((kind, err, where) => reportClientError(kind, err, where));
  clock = opts.now ?? Date.now;
  lastSeen.clear();
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** True when this error is an expected state and must stay quiet. */
export function isExpectedFault(err: unknown): boolean {
  const kind = typeof err === "object" && err !== null ? (err as { kind?: unknown }).kind : undefined;
  if (typeof kind === "string" && EXPECTED_KINDS.has(kind)) return true;
  if (isOffline() && (kind === "network" || kind === "timeout" || kind === undefined)) return true;
  return false;
}

/** For a catch block that would otherwise swallow `err`. Never throws, never blocks. */
export function reportFault(where: FaultWhere, err: unknown): void {
  try {
    if (isExpectedFault(err)) return;
    const kind = typeof err === "object" && err !== null && typeof (err as { kind?: unknown }).kind === "string" ? (err as { kind: string }).kind : "error";
    const message = err instanceof Error ? err.message : String(err);
    const key = `${where}|${kind}|${message.slice(0, 80)}`;
    const t = clock();
    const prev = lastSeen.get(key);
    if (prev !== undefined && t - prev < REPEAT_WINDOW_MS) return;
    lastSeen.set(key, t);
    if (lastSeen.size > 200) lastSeen.clear();
    sink(`${where.replace(":", "_")}_${kind}`, err, where);
  } catch {
    /* reporting must never break the engine */
  }
}
