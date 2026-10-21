import { defaultOrgName } from "./default-org-name";

// Browser side of the silent organisation set-up. In production the browser talks to the Edge Function (src/lib/px-api.ts), which never runs
// requireAuth(), so the server-side auto-provision alone would not reach a signed-in person with no membership. This is the same step done from the
// one place every signed-in screen passes through (the (app) layout): no membership -> provision with the default name from the e-mail -> carry on.
// Concurrency: one in-flight run per person in this tab, and a cross-tab lock (Web Locks) around "check, then create" so two tabs / two page loads
// create exactly one organisation. The server endpoint is itself idempotent (alreadyProvisioned) as the last line.

export type EnsureDeps = {
  getUser: () => Promise<{ id: string; email: string | null } | null>;
  hasMembership: (userId: string) => Promise<boolean>;
  provision: (orgName: string) => Promise<{ ok: true } | { ok: false; error?: string }>;
  /** Cross-tab mutual exclusion; omitted where the browser has none. */
  lock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
};

export type EnsureResult =
  | { status: "present" }
  | { status: "provisioned" }
  | { status: "signed_out" }
  | { status: "failed"; error: string };

export const ENSURE_FAILED_MESSAGE = "We couldn't set up your workspace just now. Please try again.";

const inflight = new Map<string, Promise<EnsureResult>>();

export async function ensureOrganization(deps: EnsureDeps): Promise<EnsureResult> {
  const user = await deps.getUser();
  if (!user) return { status: "signed_out" };
  const running = inflight.get(user.id);
  if (running) return running;

  const run = async (): Promise<EnsureResult> => {
    try {
      if (await deps.hasMembership(user.id)) return { status: "present" };
      const r = await deps.provision(defaultOrgName(user.email));
      return r.ok ? { status: "provisioned" } : { status: "failed", error: r.error || ENSURE_FAILED_MESSAGE };
    } catch (err) {
      return { status: "failed", error: err instanceof Error && err.message ? err.message : ENSURE_FAILED_MESSAGE };
    }
  };
  // Inside the lock the membership is re-read, so the second tab finds what the first one wrote.
  const p = (deps.lock ? deps.lock(`px-ensure-org:${user.id}`, run) : run()).finally(() => inflight.delete(user.id));
  inflight.set(user.id, p);
  return p;
}

/** navigator.locks where it exists. */
export function webLock(): EnsureDeps["lock"] {
  const locks = typeof navigator !== "undefined" ? (navigator as unknown as { locks?: { request: (n: string, cb: () => Promise<unknown>) => Promise<unknown> } }).locks : undefined;
  if (!locks) return undefined;
  return <T,>(key: string, fn: () => Promise<T>) => locks.request(key, fn) as Promise<T>;
}

export const NO_ORGANIZATION_PATTERN = /no organi[sz]ation/i;

/**
 * Runs a create call; if it is refused with "No organization", sets the workspace up once and runs the create ONE more time. Any other failure,
 * and a second refusal, propagate untouched. A failed set-up throws the plain message instead of "No organization".
 */
export async function withOrgRetry<T>(
  create: () => Promise<T>,
  ensure: () => Promise<EnsureResult>,
  isNoOrg: (err: unknown) => boolean,
  onSetupFailed?: (detail: string) => void,
): Promise<T> {
  try {
    return await create();
  } catch (first) {
    if (!isNoOrg(first)) throw first;
    const r = await ensure();
    if (r.status === "failed" || r.status === "signed_out") {
      onSetupFailed?.(r.status === "failed" ? r.error : "signed out");
      throw new Error(ENSURE_FAILED_MESSAGE);
    }
    return create();
  }
}
