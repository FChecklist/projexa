"use client";

// R67 D-72 -- ONE submit for every create form.
//
// WHAT THE AUDIT FOUND (R-277, R-282, R-286, R-292). Twelve create screens,
// twelve hand-rolled submit handlers, and between them every failure mode was
// handled a different way or not at all:
//
//   * NO CEILING. Every one of them called fetch() with no signal. A hung
//     upstream left "Saving…" on the button for as long as the browser's own
//     default would allow -- on a mobile network that is minutes -- with no
//     way back except reloading the page and retyping the form.
//   * THE FAILURE FADED. /schedule/log-time answered a refused POST with
//     toast.error(), which is gone in four seconds; the form looked exactly
//     as it had before the click, so a user who looked away could not tell a
//     save that landed from one that did not.
//   * A CLICK THAT SENT NOTHING LOOKED IDENTICAL TO ONE THAT DID. The guard
//     `if (!issueId || !hours || !spentOn) { toast.error(...); return; }` runs
//     inside the handler: the button reads "Saving…" for one frame and then
//     goes back, and nothing was ever sent. That is the same "dead create
//     button" class src/components/PrimarySubmit.tsx documented in R52.
//   * THE RECEIPT WAS A NOTIFICATION. toast.success("Time logged") is the
//     only evidence a write happened, on a screen that then navigates away.
//
// This module owns the whole lifecycle so none of that can be re-decided per
// screen. The three parts that are DECISIONS rather than plumbing --
// what a failure says, what a receipt says, and how a backend reason is
// terminated so two sentences do not run together -- are pure functions,
// unit-tested without a DOM or a network.
//
// ─── DISCLOSED DEVIATION FROM THE ITEM'S WORDING ─────────────────────────
//
// D-72 says: "on timeout or network error the form shows the footer message
// 'The server did not answer in 10 s — nothing was saved.'" The timeout half
// is used verbatim. The NETWORK-ERROR half is not, because a DNS failure or
// an offline radio rejects in milliseconds, and telling a user their request
// waited ten seconds when it never left the device is exactly the kind of
// confident falsehood this programme exists to remove. An unreachable server
// gets its own sentence, which is the same shape and equally short.

import { useCallback, useEffect, useRef, useState } from "react";
import { backendMessage } from "@/lib/fetch-json";
import { isTaskErrorCode, messageFor } from "@/lib/task-errors";

/** The ceiling on a write. Ten seconds, per R-277. */
export const SUBMIT_TIMEOUT_MS = 10_000;

/**
 * How long a submit may spend BEFORE a request is on the wire. Past this the
 * button is handed back rather than left saying "Saving…" over nothing.
 */
export const SUBMIT_WATCHDOG_MS = 100;

/**
 * The reason a refusal states: the dictionary's sentence when the server sent
 * a code it knows, and the backend's own words otherwise. An unrecognised
 * code falls through to the prose rather than to a blank, because a message
 * nobody can read is still better than no message at all.
 */
function refusalReason(body: unknown, status: number): string {
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  if (typeof code === "string" && isTaskErrorCode(code)) return messageFor(code);
  return backendMessage(body, status);
}

export type SubmitState = "idle" | "saving" | "saved";

export type SubmitFailureKind =
  /** The click produced no request at all. */
  | "not-sent"
  /** The server answered, and refused. */
  | "refused"
  /** The server accepted the connection and never answered in time. */
  | "timeout"
  /** The request never reached a server. */
  | "unreachable"
  /** A 2xx whose body did not confirm what was saved. */
  | "unconfirmed";

export type SubmitFailure = {
  kind: SubmitFailureKind;
  /** The whole sentence the user reads. Never a fragment to be framed again. */
  message: string;
  /** Whether offering "Try again" is honest for this kind of failure. */
  retryable: boolean;
};

/**
 * A backend reason, terminated so it cannot run into the sentence that
 * follows it. An empty reason is replaced rather than left as a gap -- "Could
 * not save the permit —  Nothing was saved." is a bug the user can see.
 */
export function terminate(reason: string | null | undefined): string {
  const text = (reason ?? "").trim();
  if (!text) return "the server gave no reason.";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * The sentence for each failure. `objectLabel` is the word the user reads on
 * the screen ("Permit", "BOQ"), never an endpoint or a table name.
 */
export function submitFailure(
  kind: SubmitFailureKind,
  objectLabel: string,
  reason?: string | null,
  /** The ceiling that actually expired, so the sentence cannot overstate it. */
  timeoutMs: number = SUBMIT_TIMEOUT_MS
): SubmitFailure {
  const object = objectLabel.trim().toLowerCase();
  switch (kind) {
    case "not-sent":
      return { kind, message: "Nothing was sent — try again", retryable: true };
    case "timeout":
      return {
        kind,
        message: `The server did not answer in ${Math.round(timeoutMs / 1000)} s — nothing was saved.`,
        retryable: true,
      };
    case "unreachable":
      return {
        kind,
        message: "The request never reached the server — nothing was saved.",
        retryable: true,
      };
    case "unconfirmed":
      // A 2xx that did not say what it saved. The screens this replaced threw
      // "The server did not confirm a saved permit." into the same box that
      // then appended "Nothing was saved." -- a claim nobody could make about
      // a request the server ACCEPTED. And a Try again here risks a second
      // copy of a record that may already exist, so it is not offered.
      return {
        kind,
        message: `The ${object} was accepted but the server did not confirm it — ${terminate(
          reason
        )} Check the list before saving again.`,
        retryable: false,
      };
    case "refused":
    default:
      return {
        kind: "refused",
        message: `Could not save the ${object} — ${terminate(reason)} Nothing was saved.`,
        retryable: true,
      };
  }
}

/**
 * The form itself refused: something it can check without asking the server
 * is wrong, so nothing was sent. Retrying would fail identically -- the user
 * has to change a value -- so no "Try again" is offered.
 *
 * The message is the form's own sentence (a BOQ line's specific complaint),
 * because "Nothing was sent — try again" would throw away the one thing that
 * tells the user which line to look at.
 */
export function formFailure(message: string): SubmitFailure {
  return { kind: "not-sent", message, retryable: false };
}

/**
 * The receipt a successful save produces.
 *
 * C-14 (the shell message region above the composer) is the surface that
 * renders this; it is another lane's item and its store does not exist in
 * this branch yet. The PAYLOAD is built and tested here, beside the code that
 * knows what was saved, so adopting that region is one wiring line rather
 * than twelve screens each inventing their own wording. Until then the
 * durable receipt is the one src/components/CreatedReceipt.tsx already puts
 * in the URL, which survives the navigation AND a refresh.
 */
export type SubmitReceipt = { kind: "saved"; text: string; href?: string };

export function savedReceipt(
  objectLabel: string,
  identifier?: string | null,
  href?: string
): SubmitReceipt {
  const id = (identifier ?? "").trim();
  return { kind: "saved", text: id ? `Saved — ${objectLabel} ${id}` : `Saved — ${objectLabel}`, href };
}

/** What the caller wants sent. `null` means "nothing should be sent". */
export type SubmitRequest = { input: RequestInfo | URL; init?: RequestInit };

export type UseSubmitOptions<T> = {
  /** The object being created, in the words on screen: "Permit", "Worker". */
  objectLabel: string;
  /**
   * Builds the request. Returning null (or throwing) means the click produced
   * nothing, and the user is told so instead of watching a button that says
   * "Saving…" flick back to normal.
   */
  buildRequest: () => SubmitRequest | null | Promise<SubmitRequest | null>;
  /** Runs on a 2xx, with the parsed body. Navigation belongs here. */
  onSuccess: (body: T) => void | Promise<void>;
  /**
   * A chance to handle a transport failure instead of showing it. Return true
   * when it was handled -- the Work Progress form queues the entry offline,
   * which is a real second outcome and not an error at all.
   */
  onTransportError?: (error: unknown) => boolean | Promise<boolean>;
  /**
   * The ceiling on this particular write. Defaults to {@link SUBMIT_TIMEOUT_MS}
   * and exists because a multi-megabyte drawing upload is a different contract
   * from a four-field JSON POST -- not so a screen can opt out of having one.
   */
  timeoutMs?: number;
};

export type UseSubmit = {
  state: SubmitState;
  failure: SubmitFailure | null;
  /** True from the click until the outcome is known. */
  saving: boolean;
  /** True once a 2xx landed. The button says "Saved" while navigation runs. */
  saved: boolean;
  submit: () => void;
  /** Clears a failure without sending anything (used when a field changes). */
  clearFailure: () => void;
};

export function useSubmit<T = unknown>({
  objectLabel,
  buildRequest,
  onSuccess,
  onTransportError,
  timeoutMs = SUBMIT_TIMEOUT_MS,
}: UseSubmitOptions<T>): UseSubmit {
  const [state, setState] = useState<SubmitState>("idle");
  const [failure, setFailure] = useState<SubmitFailure | null>(null);

  // A submit outlives a re-render, so the in-flight guard cannot be state.
  const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // The callbacks are read through a ref so a caller may pass inline closures
  // (every one of the twelve screens does) without the hook re-arming. The
  // ref is refreshed in an effect rather than during render, and effects flush
  // before the browser paints, so a click can never see a stale closure.
  const opts = useRef({ objectLabel, buildRequest, onSuccess, onTransportError, timeoutMs });
  useEffect(() => {
    opts.current = { objectLabel, buildRequest, onSuccess, onTransportError, timeoutMs };
  });

  const clearFailure = useCallback(() => setFailure(null), []);

  const submit = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    // Synchronous, so the button reads "Saving…" on the very next paint --
    // R-277's "within 100 ms" is met by never leaving the click handler
    // before the state is set.
    setState("saving");
    setFailure(null);

    void (async () => {
      const {
        objectLabel: label,
        buildRequest: build,
        onSuccess: done,
        onTransportError: onTransport,
        timeoutMs: ceilingMs,
      } = opts.current;

      // ONE controller carries both deadlines, and `abortedAs` records which
      // of them fired -- so the sentence the user reads names the deadline
      // that actually expired rather than guessing from an AbortError.
      //
      // The timeout is a plain setTimeout over this controller rather than
      // AbortSignal.timeout(): the ceiling on a WRITE must not depend on a
      // platform helper being present, and a runtime without it would
      // otherwise throw before the request was ever issued.
      const guard = new AbortController();
      let abortedAs: SubmitFailureKind | null = null;
      let issued = false;
      let notSent = false;
      const watchdog = setTimeout(() => {
        if (issued) return;
        notSent = true;
        abortedAs = "not-sent";
        guard.abort();
        if (!live.current) return;
        setFailure(submitFailure("not-sent", label));
        setState("idle");
        inFlight.current = false;
      }, SUBMIT_WATCHDOG_MS);

      let request: SubmitRequest | null = null;
      try {
        request = await build();
      } catch {
        request = null;
      }

      if (notSent) {
        clearTimeout(watchdog);
        return; // already reported, and the guard is aborted
      }
      if (!request) {
        clearTimeout(watchdog);
        inFlight.current = false;
        if (!live.current) return;
        setFailure(submitFailure("not-sent", label));
        setState("idle");
        return;
      }

      issued = true;
      clearTimeout(watchdog);

      const init = request.init ?? {};
      const ceiling = setTimeout(() => {
        abortedAs = "timeout";
        guard.abort();
      }, ceilingMs);
      try {
        const res = await fetch(request.input, { ...init, signal: guard.signal });
        const body: unknown = await res.json().catch(() => null);
        clearTimeout(ceiling);

        if (!res.ok) {
          inFlight.current = false;
          if (!live.current) return;
          // R67 B-09 (D-03): a route that refuses on a RULE answers with a
          // CODE, and the client owns the wording. Rendering it through the
          // same dictionary the composer uses is what makes both paths
          // produce the same words -- "Pick a BOQ line", never "itemCode"
          // and never "boqLineItemId". Applied HERE rather than in one
          // screen's handler, so every create form gets it and none of them
          // can render a coded refusal as prose.
          setFailure(submitFailure("refused", label, refusalReason(body, res.status)));
          setState("idle");
          return;
        }

        // "Saved" stays on the button while onSuccess navigates: the screen
        // must never look idle between a landed write and the page it lands
        // on. inFlight stays true so a second click cannot re-post.
        if (live.current) setState("saved");
        try {
          await done(body as T);
        } catch (err) {
          // onSuccess is where a screen checks that the 2xx actually carried
          // the record it claimed to save. Its refusal is a different fact
          // from a transport failure and must not be classified as one.
          inFlight.current = false;
          if (!live.current) return;
          setFailure(submitFailure("unconfirmed", label, err instanceof Error ? err.message : null));
          setState("idle");
          return;
        }
        inFlight.current = false;
      } catch (err) {
        clearTimeout(ceiling);
        inFlight.current = false;
        if (!live.current) return;
        // A deadline we set ourselves is the authority on why the request
        // stopped; only an unexplained rejection is classified from the error.
        const kind: SubmitFailureKind = abortedAs ?? failureKind(err);
        if (kind === "not-sent") return; // the watchdog already said so

        if (onTransport && kind !== "refused") {
          const handled = await onTransport(err);
          if (handled) {
            setState("idle");
            return;
          }
        }
        setFailure(submitFailure(kind, label, null, ceilingMs));
        setState("idle");
      }
    })();
  }, []);

  return {
    state,
    failure,
    saving: state === "saving",
    saved: state === "saved",
    submit,
    clearFailure,
  };
}

/**
 * Classifies a rejection that no deadline of ours explains. `TypeError` is
 * what fetch throws for DNS, a dropped radio and a refused connection;
 * `TimeoutError` is what a platform-level AbortSignal.timeout would produce
 * if one were ever composed into a request from outside this hook.
 *
 * Nothing here can return "refused": a refusal is a RESPONSE, handled where
 * the status is read, never in the catch.
 */
export function failureKind(err: unknown): SubmitFailureKind {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") return "timeout";
  if (name === "AbortError") return "not-sent";
  return "unreachable";
}
