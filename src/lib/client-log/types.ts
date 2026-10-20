// Device-side error and action log (owner wish: every error in real use is captured with a COMPLETE report, every project and action is
// followed from start to end, all of it on the person's OWN phone or laptop; the server only stores the rows).
// The wire contract is POST /api/client-logs { events: ClientLogEvent[] } (<= 50), answered { accepted, rejected: [{ index, reason }] }.

export type ClientLogKind = "error" | "unhandled_rejection" | "render_error" | "api_failure" | "action";
export type ClientLogSeverity = "error" | "warning" | "info";

export type Breadcrumb = {
  t: string; // ISO time
  type: "nav" | "click" | "submit" | "api" | "error";
  label: string;
  route: string;
};

export type ClientLogContext = {
  userAgent: string;
  platform: string;
  screen: string;
  language: string;
  online: boolean;
  appVersion: string;
  /** Same problem seen again within 30 s on this device: counted once, with how many extra times. */
  repeatCount?: number;
};

export type ClientLogEvent = {
  id: string;
  kind: ClientLogKind;
  severity: ClientLogSeverity;
  fingerprint: string;
  message: string;
  stack: string | null;
  route: string;
  projectId: string | null;
  sessionId: string;
  apiPath: string | null;
  httpMethod: string | null;
  httpStatus: number | null;
  requestId: string | null;
  durationMs: number | null;
  actionName: string | null;
  outcome: "ok" | "failed" | null;
  breadcrumbs: Breadcrumb[];
  context: ClientLogContext;
  occurredAt: string;
};

export type SendResult = { status: number; accepted?: number; rejected?: { index: number; reason: string }[]; retryAfterMs?: number };

/** An event the outbox must never drop (errors); actions are the first to go when the device store is full. */
export const isErrorEvent = (e: Pick<ClientLogEvent, "kind">): boolean => e.kind !== "action";
