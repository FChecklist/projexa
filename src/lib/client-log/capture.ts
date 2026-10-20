// The capture core: turns "something happened" into a complete, redacted event and hands it to the outbox.
// Pure of the DOM: everything it needs from the browser comes in through `env`, so it is tested without one.
// RULE: nothing in here may throw into the app. Every public function swallows its own failure.

import { createBreadcrumbs, type Breadcrumbs } from "./breadcrumbs";
import { fingerprintOf } from "./fingerprint";
import { redactDeep, scrubText } from "./redact";
import type { Breadcrumb, ClientLogContext, ClientLogEvent, ClientLogKind, ClientLogSeverity } from "./types";

export const DEDUPE_WINDOW_MS = 30_000;
/** A render loop or a runaway handler must not become a flood: past this many events a minute, the rest of that minute is ignored. */
export const MAX_EVENTS_PER_MINUTE = 120;

export type CaptureEnv = {
  now: () => number;
  newId: () => string;
  sessionId: string;
  getRoute: () => string;
  getProjectId: () => string | null;
  getContext: () => ClientLogContext;
};

export type OutboxLike = { enqueue(e: ClientLogEvent): void; patch(id: string, fn: (e: ClientLogEvent) => ClientLogEvent): boolean };

export type ErrorInput = {
  kind: Exclude<ClientLogKind, "action">;
  severity?: ClientLogSeverity;
  message: unknown;
  stack?: string | null;
  apiPath?: string | null;
  httpMethod?: string | null;
  httpStatus?: number | null;
  requestId?: string | null;
  durationMs?: number | null;
  projectId?: string | null;
};

export type ActionInput = {
  actionName: string;
  outcome: "ok" | "failed";
  durationMs?: number | null;
  projectId?: string | null;
  apiPath?: string | null;
  httpMethod?: string | null;
  httpStatus?: number | null;
};

export function createCapture(env: CaptureEnv, outbox: OutboxLike, breadcrumbs: Breadcrumbs = createBreadcrumbs(env.now)) {
  const recent = new Map<string, { at: number; id: string; repeats: number }>();
  let windowStart = 0;
  let inWindow = 0;

  function overRate(): boolean {
    const t = env.now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      inWindow = 0;
    }
    inWindow += 1;
    return inWindow > MAX_EVENTS_PER_MINUTE;
  }

  function base(kind: ClientLogKind, severity: ClientLogSeverity, message: string, stack: string | null, route: string): ClientLogEvent {
    return {
      id: env.newId(),
      kind,
      severity,
      fingerprint: fingerprintOf({ kind, message, route, stack }),
      message,
      stack,
      route,
      projectId: null,
      sessionId: env.sessionId,
      apiPath: null,
      httpMethod: null,
      httpStatus: null,
      requestId: null,
      durationMs: null,
      actionName: null,
      outcome: null,
      breadcrumbs: [],
      context: env.getContext(),
      occurredAt: new Date(env.now()).toISOString(),
    };
  }

  function captureError(input: ErrorInput): void {
    try {
      const route = env.getRoute();
      const message = scrubText(input.message instanceof Error ? `${input.message.name}: ${input.message.message}` : input.message, 1000) || "Unknown error";
      const stack = input.stack ?? (input.message instanceof Error ? input.message.stack ?? null : null);
      const ev = base(input.kind, input.severity ?? "error", message, stack ? scrubText(stack, 4000) : null, route);
      ev.projectId = input.projectId ?? env.getProjectId();
      ev.apiPath = input.apiPath ?? null;
      ev.httpMethod = input.httpMethod ?? null;
      ev.httpStatus = input.httpStatus ?? null;
      ev.requestId = input.requestId ?? null;
      ev.durationMs = input.durationMs ?? null;

      // the same problem again within 30 s on this device: counted once, with a repeat count
      const seen = recent.get(ev.fingerprint);
      if (seen && env.now() - seen.at < DEDUPE_WINDOW_MS) {
        seen.repeats += 1;
        outbox.patch(seen.id, (e) => ({ ...e, context: { ...e.context, repeatCount: seen.repeats } }));
        return;
      }
      if (overRate()) return;
      recent.set(ev.fingerprint, { at: env.now(), id: ev.id, repeats: 0 });
      if (recent.size > 200) recent.delete(recent.keys().next().value as string);

      // the error is itself the last step of the story
      breadcrumbs.add("error", message.slice(0, 100), route);
      ev.breadcrumbs = breadcrumbs.snapshot().slice(-30);
      outbox.enqueue(redactDeep(ev));
    } catch {
      /* capturing must never break the app */
    }
  }

  function captureAction(input: ActionInput): void {
    try {
      if (overRate()) return;
      const route = env.getRoute();
      const name = scrubText(input.actionName, 120);
      const ev = base("action", input.outcome === "failed" ? "warning" : "info", `${name}: ${input.outcome}`, null, route);
      // an action's fingerprint groups the same action on the same screen, not a message
      ev.fingerprint = fingerprintOf({ kind: "action", message: name, route, stack: null });
      ev.projectId = input.projectId ?? env.getProjectId();
      ev.actionName = name;
      ev.outcome = input.outcome;
      ev.durationMs = input.durationMs ?? null;
      ev.apiPath = input.apiPath ?? null;
      ev.httpMethod = input.httpMethod ?? null;
      ev.httpStatus = input.httpStatus ?? null;
      ev.breadcrumbs = breadcrumbs.snapshot().slice(-5);
      outbox.enqueue(redactDeep(ev));
    } catch {
      /* ignore */
    }
  }

  function crumb(type: Breadcrumb["type"], label: string, route?: string): void {
    try {
      breadcrumbs.add(type, scrubText(label, 120), route ?? env.getRoute());
    } catch {
      /* ignore */
    }
  }

  return { captureError, captureAction, crumb, breadcrumbs };
}
export type Capture = ReturnType<typeof createCapture>;
