"use client";

// GUIDED ERRORS, GROUP G3 -- the small shared pieces the G3 screens (materials, labour, documents, drawings, permits, MoMs, schedule, design studio,
// reports, settings) use so a mistake a person makes on a form is handled the same way everywhere:
//
//   * useFormDraft(key, initial)  every typed value of a form survives a "Fix it now" detour, a reload and a sign-in that ran out, and is thrown away
//                                 after a successful save. Thin wrapper over useDraft (src/lib/error-guide/use-draft.ts) for forms that keep their
//                                 values as Record<string,string>.
//   * fault(code, field, text)    a mistake the form found itself, before anything was sent, as a SubmitFailure carrying the client CODE the catalogue
//                                 expects (docs/ERROR_CATALOGUE.md, "Codes the screens must raise") and the id of the input it is about, so the panel's
//                                 "Fix it now" button highlights exactly that input.
//   * useCheckedSubmit(submit, check)  runs the form's own checks first; a fault is shown in the same panel as a server refusal, and disappears when
//                                 the person edits anything.
//
// Nothing here runs at page load (init stays lazy): the hooks only touch sessionStorage after the form is on screen.

import { useCallback, useState } from "react";
import { contextFromError, contextFromFailure } from "@/lib/error-guide/context";
import { useDraft } from "@/lib/error-guide/use-draft";
import type { GuideContext } from "@/lib/error-guide/types";
import type { SubmitFailure, UseSubmit } from "@/lib/use-submit";

export type FormValues = Record<string, string>;

export type FormDraft = {
  values: FormValues;
  /** Change one field (kept in the draft). */
  onChange: (name: string, value: string) => void;
  /** Change several at once. */
  patch: (next: FormValues) => void;
  /** Forget the draft: after a successful save. */
  clear: () => void;
  /** True when the form was filled from an earlier visit. */
  restored: boolean;
  startFresh: () => void;
};

/** A form's typed values, kept across leaving and coming back. `key` should name the form AND the project, e.g. `material-new:${projectId}`. */
export function useFormDraft(key: string, initial: FormValues = {}): FormDraft {
  const draft = useDraft<FormValues>(key, initial);
  const onChange = useCallback((name: string, value: string) => draft.set({ [name]: value }), [draft.set]);
  return { values: draft.value, onChange, patch: draft.set, clear: draft.clear, restored: draft.restored, startFresh: draft.startFresh };
}

/** A mistake found by the form itself. Nothing was sent, so there is no "Try again": the person corrects the field. */
export function fault(code: string, field: string | undefined, text: string): SubmitFailure {
  return { kind: "not-sent", message: text, retryable: false, code, field, serverMessage: text };
}

export type Check = () => SubmitFailure | null;

export type CheckedSubmit = {
  failure: SubmitFailure | null;
  /** Pass to the form's save: runs the checks, then the real submit. */
  onSubmit: () => void;
  /** Pass to the panel's "Try again". */
  onRetry: () => void;
  /** Forget the form's own fault (call when a field changes). */
  clearFault: () => void;
  /** Show a fault from outside the submit (a prerequisite, a file check). */
  raise: (f: SubmitFailure) => void;
};

export function useCheckedSubmit(submit: UseSubmit, check: Check): CheckedSubmit {
  const [own, setOwn] = useState<SubmitFailure | null>(null);
  const onSubmit = () => {
    const f = check();
    if (f) {
      setOwn(f);
      return;
    }
    setOwn(null);
    submit.submit();
  };
  return {
    failure: own ?? submit.failure,
    onSubmit,
    onRetry: () => {
      setOwn(null);
      submit.submit();
    },
    clearFault: () => setOwn(null),
    raise: setOwn,
  };
}

/** True for a value that is not a finite number. "" is "not a number" here: callers test emptiness separately. */
export function notANumber(v: string): boolean {
  const t = v.trim();
  return t === "" || !Number.isFinite(Number(t));
}

/** Today as yyyy-mm-dd on this device (the calendar day the person is living in, not UTC). */
export function todayLocalIso(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** The error for a refused request, carrying the facts the guide matcher reads (status, code, path, method, body). The message is the server's own words. */
export function httpError(res: { status: number }, body: unknown, fallback: string, method: string, apiPath: string): Error {
  const b = body && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : {};
  const text = typeof b.error === "string" && b.error ? b.error : fallback;
  const e = new Error(text) as Error & { status: number; code?: string; apiPath: string; method: string; body: unknown };
  e.name = "ApiError";
  e.status = res.status;
  if (typeof b.code === "string" && b.code) e.code = b.code;
  e.apiPath = apiPath;
  e.method = method.toUpperCase();
  e.body = body;
  return e;
}

// A few real server sentences (compliance-tracker veri-meeting-service, pms-time-service, the org-invite SQL function) are not in the harvested
// catalogue fixtures, so their guides are keyed on a CODE the screen derives from the server's own words. The server's sentence is still shown
// (the guide's "what" quotes it); only the choice of guide uses this table.
const SERVER_MESSAGE_CODES: Array<[RegExp, string]> = [
  [/meeting is already published/i, "MOM_ALREADY_PUBLISHED"],
  [/published and locked/i, "MOM_LOCKED"],
  [/only published meetings can be shared/i, "MOM_SHARE_UNPUBLISHED"],
  [/meeting has no minutes/i, "MOM_NO_MINUTES"],
  [/no ai provider configured/i, "AI_OFF"],
  [/that person is not in your organisation/i, "MOM_ASSIGNEE_NOT_IN_ORG"],
  [/share link (not found|is invalid or has expired)/i, "MOM_SHARE_EXPIRED"],
  [/hours must be more than 0|hours must be a positive number/i, "HOURS_RANGE"],
  [/only a draft or returned time entry/i, "TIMESHEET_LOCKED"],
  [/no hours logged for this day/i, "EMPTY_DAY"],
  [/no submitted hours to review/i, "DAY_NOT_SUBMITTED"],
  [/cannot review their own/i, "SELF_REVIEW"],
  [/invitation has been revoked/i, "INVITE_REVOKED"],
  [/issued to a different email/i, "INVITE_WRONG_EMAIL"],
];

/** The G3 guide code for a server sentence, or undefined when the catalogue already matches it by its words. */
export function serverMessageCode(message: string | undefined | null): string | undefined {
  if (!message) return undefined;
  for (const [re, code] of SERVER_MESSAGE_CODES) if (re.test(message)) return code;
  return undefined;
}

/** `extra` for contextFromError(): the caller's own facts plus the derived code, only when the error did not carry a code of its own. */
export function withServerCode(err: unknown, extra: Partial<GuideContext> = {}): Partial<GuideContext> {
  const own = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (typeof own === "string" && own) return extra;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : undefined;
  const code = serverMessageCode(msg);
  return code ? { ...extra, code } : extra;
}

export type Problem = { ctx: GuideContext; message?: string; retry?: () => void };

/**
 * The failure of a write that is NOT a create form (an edit, a status change, a delete, a void): kept as the facts of the error, so the screen can
 * show the complete guide for it (see ProblemPanel). `base` is what only the screen knows (project, entity). `show(err, text)` replaces the
 * screen's old one-line message; `text` stays the sentence the person reads first, the guide adds why, the steps, the exact place and the way back.
 */
export function useProblem(base: Partial<GuideContext> = {}) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const show = useCallback(
    (err: unknown, message?: string, retry?: () => void, extra: Partial<GuideContext> = {}) =>
      setProblem({ ctx: contextFromError(err, withServerCode(err, { ...base, ...extra })), message, retry }),
    [base.projectId, base.entityId, base.entityType]
  );
  const showFault = useCallback((f: SubmitFailure, extra: Partial<GuideContext> = {}) => {
    setProblem({ ctx: contextFromFailure(f, { ...base, ...extra }), message: f.message });
  }, [base.projectId, base.entityId, base.entityType]);
  const clear = useCallback(() => setProblem(null), []);
  return { problem, show, showFault, clear };
}

