// P1c: the browser wiring of runPostLogin (src/lib/auth/post-login.ts), shared by /login (after a verified code) and /auth/callback (after Google).
import { createIdentityStore, mirrorSession } from "@/lib/local-first/identity";
import { openDeviceMeta } from "@/lib/local-first/device-meta";
import { prewarmReleaseBundle } from "@/lib/local-first/release/prewarm";
import { ensureServiceWorker } from "@/lib/local-first/release/sw-client";
import { viaPxApi } from "@/lib/px-api";
import type { PostLoginDeps } from "./post-login";

type SupabaseLike = {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null } }> };
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export function postLoginDeps(
  supabase: SupabaseLike,
  identityStore: () => ReturnType<typeof createIdentityStore> = () => createIdentityStore({ storage: window.localStorage, openMeta: () => openDeviceMeta() }),
  t: (key: "genericError" | "provisionError") => string = (k) => (k === "genericError" ? "Something went wrong. Please try again." : "We could not finish setting up your organisation. Please try again."),
): PostLoginDeps {
  return {
    getSession: async () => (await supabase.auth.getSession()).data.session,
    hasMembership: async (userId) => {
      const { data } = await supabase.from("memberships").select("organization_id").eq("user_id", userId).limit(1).maybeSingle();
      return Boolean(data);
    },
    storage: window.localStorage,
    provision: async (orgName) => {
      const res = await viaPxApi("/api/org/provision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgName }) });
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => ({} as { error?: string }));
      return { ok: false, error: (body as { error?: string }).error };
    },
    saveIdentity: (session) => mirrorSession(identityStore(), session as never),
    startShellInstall: () => Promise.all([ensureServiceWorker(), prewarmReleaseBundle()]),
    messages: { genericError: t("genericError"), provisionError: t("provisionError") },
  };
}
