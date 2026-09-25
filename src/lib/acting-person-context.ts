// PROJEXA-BUILD-001 U-20b (PROJEXA half) -- THE ACTING PERSON OF THIS REQUEST.
//
// WHY THIS EXISTS. compliance-tracker now refuses an API-key write that names
// nobody (HTTP 400 ACTING_USER_REQUIRED): PROJEXA authenticates to VERIDIAN
// with one shared per-org key, so every write has to say, in the
// X-Acting-User / X-Acting-User-Email headers, which person it is made for.
// veridian-client.ts always had per-call `actingUserId` / `actingUserEmail`
// options, but ~140 route files would each have had to remember to pass them,
// and the next route added would forget. This module lets the client find the
// person on its own, the same way request-timing.ts lets it find the timing
// ledger: one scope per request, read wherever a call is made.
//
// THE THREE MOVING PARTS, AND WHERE EACH LIVES.
//   1. withTiming() (src/lib/with-timing.ts) -- the wrapper every /api/* route
//      wears -- opens a fresh, EMPTY slot for the request with
//      runWithActingPersonScope(), and closes and clears it when the handler
//      settles (rule c below).
//   2. requireAuth() (src/lib/supabase/auth-guard.ts) -- the one place an API
//      route resolves its verified session user -- writes that user into the
//      slot with recordVerifiedActingPerson(). requireCompanyScope() and
//      getServerOrganizationId() go through requireAuth(), so they record too.
//   3. veridian-client.ts reads currentActingPerson() when a call site did not
//      pass an explicit identity, and turns it into the two headers.
//
// WHY THE SCOPE IS OPENED IN withTiming() AND NOT IN requireAuth() ITSELF.
// Measured on this machine, Node v26.3.1 and Bun 1.3.14 (the test runtime),
// with a probe shaped exactly like requireAuth: AsyncLocalStorage.run() only
// scopes the callback it is given, and requireAuth() is a callee that RETURNS
// to the route -- a run() inside it would be over before the route made its
// first VERIDIAN call. The alternative, AsyncLocalStorage.enterWith() inside
// requireAuth(), does not reach the caller at all: requireAuth() only knows the
// user after its first `await`, and a caller's `await requireAuth()` resumes in
// the async context it captured when it started waiting, so the store set
// after that point is invisible to it (probe result: null on both runtimes).
// A MUTABLE slot inside a run() scope that is already open around the whole
// handler is visible to the handler after requireAuth() fills it (probe
// result: the user, on both runtimes). Hence: the wrapper opens the scope, the
// auth guard fills it. Route handlers run on the Node runtime here -- no route
// under src/app/api declares `export const runtime`, and Next 16's default for
// a route handler is Node, where node:async_hooks exists; src/middleware.ts is
// the one Edge module and never imports this file.
//
// SECURITY RULES, EACH ONE PINNED BY A TEST (acting-person-context.test.ts):
//   a. The identity comes ONLY from requireAuth()'s verified session (the
//      JWT claims getClaims() checked). Nothing here reads a request header or
//      body, and veridian-client builds its outbound headers from scratch, so
//      an inbound X-Acting-User / X-Acting-User-Email from the browser is never
//      forwarded; a JSON body's `actorEmail` on a session call is overwritten
//      with the session's own email (see veridian-client.ts).
//   b. Two overlapping requests never see each other's person: each request
//      gets its own slot object from its own run() scope.
//   c. The slot is closed and emptied when the request ends, so work that
//      outlives the response (a stray timer, an un-awaited promise) carries no
//      identity at all rather than a stale one.
// No scope at all -- a server component, a script, the Google Sheets webhook,
// inbound email, org provisioning -- means no person, and veridian-client sends
// no acting headers, exactly as before this module existed.

import { AsyncLocalStorage } from "node:async_hooks";

export type ActingPerson = {
  /** The Supabase auth user id (the JWT `sub`) -- what X-Acting-User carries. */
  readonly userId: string;
  /** The session's email, when the JWT has one -- X-Acting-User-Email. */
  readonly email: string | null;
};

type Slot = {
  person: ActingPerson | null;
  /** False once the request that opened this slot has ended (rule c). */
  open: boolean;
  /**
   * Set if two DIFFERENT users were ever recorded into one request's slot.
   * That cannot happen through a real session (one request, one cookie), so if
   * it does, something is wrong and the slot fails closed: no identity is sent
   * for the rest of the request rather than possibly the wrong one.
   */
  conflicted: boolean;
};

const slots = new AsyncLocalStorage<Slot>();

/** A slot nothing can write to and nothing reads a person from. */
const NO_PERSON: Slot = Object.freeze({ person: null, open: false, conflicted: false }) as Slot;

/**
 * Runs one request's handler with its own acting-person slot, and closes that
 * slot when the handler settles -- resolved or thrown.
 *
 * A scope opened inside another one (a wrapped handler calling another wrapped
 * handler within the same request) starts from the enclosing request's person:
 * it is the same request, so it is the same person.
 */
export async function runWithActingPersonScope<T>(fn: () => Promise<T>): Promise<T> {
  const enclosing = slots.getStore();
  const slot: Slot = {
    person: enclosing && enclosing.open && !enclosing.conflicted ? enclosing.person : null,
    open: true,
    conflicted: false,
  };
  try {
    return await slots.run(slot, fn);
  } finally {
    slot.open = false;
    slot.person = null;
  }
}

/**
 * Records the request's verified session user. Called by requireAuth() ONLY,
 * after the session JWT has been verified and the caller's membership read --
 * never with anything taken from the request itself. A no-op outside a scope.
 */
export function recordVerifiedActingPerson(user: { id: string; email: string | null }): void {
  const slot = slots.getStore();
  if (!slot || !slot.open || slot.conflicted) return;
  if (typeof user.id !== "string" || !user.id) return;
  if (slot.person && slot.person.userId !== user.id) {
    console.error("[acting-person] two different session users were recorded in one request -- sending no acting identity for the rest of it");
    slot.conflicted = true;
    slot.person = null;
    return;
  }
  slot.person = Object.freeze({ userId: user.id, email: user.email || null });
}

/** The person this request acts for, or null (no scope, no session, or the request has ended). */
export function currentActingPerson(): ActingPerson | null {
  const slot = slots.getStore();
  if (!slot || !slot.open || slot.conflicted) return null;
  return slot.person;
}

/**
 * Runs `fn` as nobody. For work whose result is SHARED between people -- a
 * cross-request cache fill (see person-free-cache.ts) -- where attaching the
 * person who happened to trigger it would make one person's answer everyone's.
 */
export function runWithoutActingPerson<T>(fn: () => T): T {
  return slots.run(NO_PERSON, fn);
}
