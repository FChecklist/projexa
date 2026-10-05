// LOCAL-FIRST R9 + R10 at the sign-out: the ONE function every "Sign out" button calls, joining the two halves that were built apart.
//
//   identity.ts  signOutDeliberately()           -- clears the durable identity mirror, tells the service worker to delete this
//                                                    person's release caches, ends the Supabase session (by hand when offline).
//                                                    Until this file, NOTHING called it: a person who clicked Sign out could be
//                                                    silently signed back in from the mirror ("logged in until the person logs out"
//                                                    was broken the other way round).
//   sign-out.ts  finishLocalWorkspaceOnSignOut() -- sends the outbox while the session is alive; KEEPS this laptop's copy of the
//                                                    workspace by default (package lf-fc, cost:COST-05) and deletes it only on the
//                                                    explicit choice `deleteLocalCopy` ("Sign out and delete this laptop's copy"),
//                                                    never while edits or drafts wait (and says so).
//
// ORDER (each step must survive the failure of the next):
//   1. the workspace step FIRST: it needs the live session to send pending edits; afterwards there is no session to send them with;
//   2. then signOutDeliberately: mirror cleared, no shell served online from the release (kept for the same person's next sign-in unless the copy is
//      deleted), session ended.
// Never throws. The pending-edits notice from step 1 is returned so the caller can show it after the session has gone.
//
// What it deliberately does NOT do (R10, "the app is not deleted until the person chooses"): it never unregisters the service
// worker, never deletes caches itself and never touches the installed app. The worker's CLEAR_PERSON touches only release caches
// (`px-release-*`) and its pointer: by default it keeps the release, marked signed out (online no shell is served from it; offline it opens the passcode sign-in, B20), and the same person's next
// sign-in points the worker at it again without a download (boot.ts -> runLocalFirstBoot); with deleteLocalCopy it deletes them.
//
// The M24 shell's SIGNED_OUT listener uses classifySignedOut() below to tell a deliberate sign-out (this tab's click, or the mirror
// already emptied by another tab's click / a revoked token) from an UNEXPECTED one (a lost cookie, a failed refresh): the latter is
// not believed, nothing is cleared, and the identity mirror started by boot.ts rebuilds the session (restoreSessionIfMissing).

import { openDeviceMeta } from "./device-meta";
import {
  createIdentityStore,
  getDurableIdentity,
  isDeliberateSignOut,
  signOutDeliberately,
  type AuthLike,
  type IdentityStore,
  type SignOutDeps,
} from "./identity";
import { finishLocalWorkspaceOnSignOut, type SignOutLocalResult, type SignOutOptions } from "./sign-out";

/** The words of the one explicit "delete this laptop's copy" choice, the same on every sign-out surface. */
export const SIGN_OUT_AND_DELETE_LABEL = "Sign out and delete this laptop's copy";

/** The real identity store, built exactly as boot.ts builds it (localStorage + the device meta store). */
export function getIdentityStore(): IdentityStore {
  let storage: Storage | null = null;
  try {
    storage = typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    storage = null;
  }
  return createIdentityStore({ storage, openMeta: () => openDeviceMeta() });
}

export type SignOutEverywhereDeps = {
  /** The Supabase auth client (the caller's `supabase.auth`). */
  auth: Pick<AuthLike, "signOut">;
  /** Default: getIdentityStore(). */
  store?: IdentityStore;
  /** Default: the real service worker client. */
  sw?: SignOutDeps["sw"];
  /** Default: clearSupabaseBrowserSession(). */
  clearBrowserSession?: SignOutDeps["clearBrowserSession"];
  /** Passed to finishLocalWorkspaceOnSignOut (tests). */
  workspace?: SignOutOptions;
  /**
   * The person's explicit choice "Sign out and delete this laptop's copy" (package lf-fc, cost:COST-05). Default false: the copy of
   * the workspace STAYS on this laptop (a re-login costs nothing and works offline at once); pending edits and drafts survive either way.
   */
  deleteLocalCopy?: boolean;
  /** Default: finishLocalWorkspaceOnSignOut. */
  finishWorkspace?: (options?: SignOutOptions) => Promise<SignOutLocalResult>;
};

export type SignOutEverywhereResult = {
  /** Plain words for the person (edits kept on this laptop), or null. */
  notice: string | null;
  /** Whether Supabase itself was told; false means the session was ended locally by hand. */
  serverTold: boolean;
  workspace: SignOutLocalResult;
};

/** THE sign-out of every button: workspace step, then the deliberate identity sign-out. Never throws. */
export async function signOutEverywhere(deps: SignOutEverywhereDeps): Promise<SignOutEverywhereResult> {
  const empty: SignOutLocalResult = { pending: 0, wiped: false, notice: null };
  let workspace = empty;
  try {
    workspace = await (deps.finishWorkspace ?? finishLocalWorkspaceOnSignOut)({ ...deps.workspace, ...(deps.deleteLocalCopy ? { deleteLocalCopy: true } : {}) });
  } catch {
    workspace = empty;
  }
  let serverTold = false;
  try {
    let store: IdentityStore;
    try {
      store = deps.store ?? getIdentityStore();
    } catch {
      store = createIdentityStore({});
    }
    // AUDIT-100 A3 (step 1b): the default sign-out keeps the public release cache for this person's next sign-in (no 8.9 MB download again);
    // the explicit "delete this laptop's copy" deletes it too.
    ({ serverTold } = await signOutDeliberately({ auth: deps.auth, store, sw: deps.sw, clearBrowserSession: deps.clearBrowserSession, keepRelease: !deps.deleteLocalCopy }));
  } catch {
    serverTold = false;
  }
  return { notice: workspace.notice, serverTold, workspace };
}

export type SignedOutKind =
  /** This tab's own click: clean up and go to the login page. */
  | "deliberate"
  /** The mirror is empty (another tab's click cleared it, or the server revoked the token): the identity really ended. */
  | "ended"
  /** Unexpected (lost cookie, failed refresh) and the mirror can rebuild the session: clear nothing, do not leave the page. */
  | "restoring";

/** How the shell should treat a SIGNED_OUT event. Reads storage only; never calls Supabase (the mirror does the restoring). */
export async function classifySignedOut(deps: { store?: IdentityStore; isDeliberate?: () => boolean } = {}): Promise<SignedOutKind> {
  if ((deps.isDeliberate ?? isDeliberateSignOut)()) return "deliberate";
  try {
    const identity = await getDurableIdentity(deps.store ?? getIdentityStore());
    return identity?.session?.refresh_token ? "restoring" : "ended";
  } catch {
    return "ended";
  }
}

/** How long the shell waits before looking at the mirror again after an unexpected sign-out (a revoked token clears it by then). */
export const SIGNED_OUT_RECHECK_MS = 20_000;

/**
 * The shell's whole reaction to a SIGNED_OUT event. "deliberate" / "ended": the cleanup the shell always did (selected project,
 * BOQ copy, laptop workspace), then the login page. "restoring": NOTHING is cleared and the page stays; the mirror (boot.ts) rebuilds
 * the session. One later look decides the case where the server said the token is revoked (restoreSessionIfMissing empties the mirror
 * then): it becomes "ended". Never throws.
 */
export async function reactToSignedOut(deps: {
  cleanUp: () => void;
  goToLogin: () => void;
  classify?: () => Promise<SignedOutKind>;
  /** Default: a timer of SIGNED_OUT_RECHECK_MS. */
  wait?: () => Promise<void>;
  /** False once the shell is gone (unmounted, or signed in again): the later look is then skipped. */
  stillRelevant?: () => boolean;
}): Promise<SignedOutKind> {
  const classify = deps.classify ?? (() => classifySignedOut());
  const finish = (kind: SignedOutKind) => {
    try { deps.cleanUp(); } catch { /* best effort */ }
    try { deps.goToLogin(); } catch { /* best effort */ }
    return kind;
  };
  const first = await classify().catch(() => "ended" as const);
  if (first !== "restoring") return finish(first);
  await (deps.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, SIGNED_OUT_RECHECK_MS))))().catch(() => {});
  if (deps.stillRelevant && !deps.stillRelevant()) return first;
  const later = await classify().catch(() => "restoring" as const);
  // "deliberate" now means the person clicked Sign out meanwhile: that button does its own cleanup and navigation.
  return later === "ended" ? finish(later) : first;
}
