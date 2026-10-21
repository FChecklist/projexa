import { createClient } from "@/lib/supabase/client";
import { postLoginDeps } from "@/lib/auth/post-login-deps";
import { webLock, type EnsureDeps } from "./ensure-org-client";

/** The real browser wiring of ensureOrganization(): this session's identity, the membership read, and the same provision call sign-in already uses. */
export function browserEnsureDeps(): EnsureDeps {
  const deps = postLoginDeps(createClient() as never);
  return {
    getUser: async () => {
      const s = (await deps.getSession()) as { user: { id: string; email?: string | null } } | null;
      return s ? { id: s.user.id, email: s.user.email ?? null } : null;
    },
    hasMembership: deps.hasMembership,
    provision: deps.provision,
    lock: webLock(),
  };
}
