// P1c: the steps that run once a session exists, whichever door the person came through (the 6-digit e-mail code on /login, or the Google
// return on /auth/callback). One function, so both doors do exactly the same thing:
//   1. a session must exist,
//   2. finish organisation provisioning when a company name was kept from the old sign-up (only when the person has no membership yet),
//   3. keep this person's identity on the laptop so it reopens offline (best effort, never blocks),
//   4. start the public app shell install (best effort). The organisation's DATA copy starts afterwards, from WorkspacePrepare, as before.
// Everything outside is injected so it is testable without a browser. No token is stored or logged here.

export type PostLoginDeps = {
  getSession: () => Promise<{ user: { id: string } } | null>;
  hasMembership: (userId: string) => Promise<boolean>;
  storage: { getItem(k: string): string | null; removeItem(k: string): void } | null;
  provision: (orgName: string) => Promise<{ ok: true } | { ok: false; error?: string }>;
  saveIdentity: (session: { user: { id: string } }) => Promise<unknown>;
  startShellInstall?: () => Promise<unknown>;
  messages: { genericError: string; provisionError: string };
};

export const PENDING_ORG_KEY = "projexa_pending_org_name";

export async function runPostLogin(deps: PostLoginDeps): Promise<{ ok: true } | { ok: false; notice: string }> {
  const session = await deps.getSession();
  if (!session) return { ok: false, notice: deps.messages.genericError };
  if (!(await deps.hasMembership(session.user.id))) {
    const pending = deps.storage?.getItem(PENDING_ORG_KEY);
    if (pending) {
      const r = await deps.provision(pending);
      if (r.ok) deps.storage?.removeItem(PENDING_ORG_KEY);
      else return { ok: false, notice: r.error || deps.messages.provisionError };
    }
  }
  try { await deps.saveIdentity(session); } catch { /* the identity mirror also does this */ }
  if (deps.startShellInstall) void Promise.resolve().then(() => deps.startShellInstall!()).catch(() => {});
  return { ok: true };
}
