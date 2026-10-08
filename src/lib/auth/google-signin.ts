// P1c: "Continue with Google" is an EXTRA door next to the e-mail code. Supabase links a Google identity to an existing account that has the same
// VERIFIED e-mail by itself, so this module never links or creates anything: it only starts the Google round trip and decides whether to show the button.
// The button shows only when the Supabase project says the Google provider is on (GET {url}/auth/v1/settings -> external.google), and never offline.
import { safeRedirectPath } from "@/lib/safe-redirect";

export const GOOGLE_CACHE_KEY = "px-google-enabled-v1";

export type GoogleGateDeps = {
  supabaseUrl: string | undefined;
  anonKey: string | undefined;
  fetch: (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  isOnline: () => boolean;
  session: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
};

/** True only when the project publishes external.google === true. Any failure, a missing setting or being offline means no button. Cached for the session. */
export async function isGoogleEnabled(deps: GoogleGateDeps): Promise<boolean> {
  if (!deps.isOnline()) return false;
  try {
    const cached = deps.session?.getItem(GOOGLE_CACHE_KEY);
    if (cached === "1") return true;
    if (cached === "0") return false;
  } catch { /* storage blocked: ask again */ }
  if (!deps.supabaseUrl || !deps.anonKey) return false;
  let enabled = false;
  try {
    const res = await deps.fetch(`${deps.supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: deps.anonKey } });
    if (!res.ok) return false; // a failed check is not cached, so a later visit can try again
    const body = (await res.json()) as { external?: { google?: unknown } };
    enabled = body?.external?.google === true;
  } catch { return false; }
  try { deps.session?.setItem(GOOGLE_CACHE_KEY, enabled ? "1" : "0"); } catch { /* ignore */ }
  return enabled;
}

/** Same-origin /auth/callback carrying only a safe path (the callback re-checks it). */
export function googleRedirectTo(origin: string, redirectParam: string | null | undefined): string {
  return `${origin}/auth/callback?redirectTo=${encodeURIComponent(safeRedirectPath(redirectParam))}`;
}

export type OAuthAuthLike = {
  signInWithOAuth(args: { provider: "google"; options: { redirectTo: string } }): Promise<{ error: { message?: string } | null }>;
};

export const GOOGLE_MESSAGES = {
  couldNotStart: "We could not open Google. Please try again, or use the code sent to your e-mail.",
  cancelled: "Google sign-in was cancelled. You can try again, or use the code sent to your e-mail.",
  failed: "Google sign-in did not work. Please try again, or use the code sent to your e-mail.",
} as const;

export async function startGoogleSignIn(auth: OAuthAuthLike, origin: string, redirectParam: string | null | undefined): Promise<{ ok: true } | { ok: false; notice: string }> {
  try {
    const { error } = await auth.signInWithOAuth({ provider: "google", options: { redirectTo: googleRedirectTo(origin, redirectParam) } });
    return error ? { ok: false, notice: GOOGLE_MESSAGES.couldNotStart } : { ok: true };
  } catch {
    return { ok: false, notice: GOOGLE_MESSAGES.couldNotStart };
  }
}

/** The provider sends the person back with ?error=access_denied (cancelled) or similar. One plain sentence, never the raw code. Null = no provider error. */
export function providerReturnError(params: URLSearchParams, hash: URLSearchParams): string | null {
  const code = params.get("error") ?? hash.get("error");
  if (!code) return null;
  return code === "access_denied" ? GOOGLE_MESSAGES.cancelled : GOOGLE_MESSAGES.failed;
}
