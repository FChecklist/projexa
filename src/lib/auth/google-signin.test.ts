/// <reference types="bun-types" />
// P1c: the Google door. Gate (settings), OAuth call arguments, provider-return errors, and "same e-mail => same account".
import { describe, expect, mock, test } from "bun:test";
import { GOOGLE_CACHE_KEY, GOOGLE_MESSAGES, googleRedirectTo, isGoogleEnabled, providerReturnError, startGoogleSignIn, type GoogleGateDeps } from "./google-signin";
import { runPostLogin } from "./post-login";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const gate = (over: Partial<GoogleGateDeps> & { body?: unknown; ok?: boolean }): GoogleGateDeps => ({
  supabaseUrl: "https://x.supabase.co", anonKey: "anon", isOnline: () => true, session: mem(),
  fetch: mock(async () => ({ ok: over.ok ?? true, json: async () => over.body ?? { external: { google: true } } })),
  ...over,
});
const calls = (d: GoogleGateDeps) => (d.fetch as unknown as ReturnType<typeof mock>).mock.calls;

describe("settings gate", () => {
  test("enabled: shown, asks the settings URL with the apikey header, caches", async () => {
    const d = gate({});
    expect(await isGoogleEnabled(d)).toBe(true);
    const [url, init] = calls(d)[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://x.supabase.co/auth/v1/settings");
    expect(init.headers.apikey).toBe("anon");
    expect(await isGoogleEnabled(d)).toBe(true);
    expect(calls(d).length).toBe(1);
  });
  test("disabled (external.google false or absent): not shown", async () => {
    expect(await isGoogleEnabled(gate({ body: { external: { google: false } } }))).toBe(false);
    expect(await isGoogleEnabled(gate({ body: {} }))).toBe(false);
  });
  test("fetch fails, bad status or missing config: not shown, and a failure is not cached", async () => {
    const s = mem();
    expect(await isGoogleEnabled(gate({ session: s, fetch: async () => { throw new Error("net"); } }))).toBe(false);
    expect(await isGoogleEnabled(gate({ session: s, ok: false }))).toBe(false);
    expect(s.getItem(GOOGLE_CACHE_KEY)).toBeNull();
    expect(await isGoogleEnabled(gate({ anonKey: undefined }))).toBe(false);
  });
  test("offline: not shown and nothing fetched, even if cached on", async () => {
    const s = mem(); s.setItem(GOOGLE_CACHE_KEY, "1");
    const d = gate({ session: s, isOnline: () => false });
    expect(await isGoogleEnabled(d)).toBe(false);
    expect(calls(d).length).toBe(0);
  });
});

describe("OAuth call", () => {
  test("provider google, redirectTo same-origin /auth/callback with only a safe path", async () => {
    const signInWithOAuth = mock(async (_a: unknown) => ({ error: null }));
    expect((await startGoogleSignIn({ signInWithOAuth } as never, "https://projexa-ai.com", "/invite/abc")).ok).toBe(true);
    expect(signInWithOAuth.mock.calls[0]![0]).toEqual({ provider: "google", options: { redirectTo: "https://projexa-ai.com/auth/callback?redirectTo=%2Finvite%2Fabc" } });
    await startGoogleSignIn({ signInWithOAuth } as never, "https://projexa-ai.com", "https://evil.example/x");
    const rt = (signInWithOAuth.mock.calls[1]![0] as { options: { redirectTo: string } }).options.redirectTo;
    expect(new URL(rt).origin).toBe("https://projexa-ai.com");
    expect(rt).toBe("https://projexa-ai.com/auth/callback?redirectTo=%2Fdashboard");
    expect(googleRedirectTo("https://a.b", "//evil.example")).toBe("https://a.b/auth/callback?redirectTo=%2Fdashboard");
  });
  test("a start failure is one plain sentence", async () => {
    const r = await startGoogleSignIn({ signInWithOAuth: async () => ({ error: { message: "provider_disabled 400" } }) } as never, "https://a.b", null);
    expect(r).toEqual({ ok: false, notice: GOOGLE_MESSAGES.couldNotStart });
  });
});

describe("provider return errors", () => {
  test("cancelled and other errors are plain, never the raw code", () => {
    expect(providerReturnError(new URLSearchParams("error=access_denied&error_description=User+denied"), new URLSearchParams())).toBe(GOOGLE_MESSAGES.cancelled);
    expect(providerReturnError(new URLSearchParams(), new URLSearchParams("error=server_error"))).toBe(GOOGLE_MESSAGES.failed);
    expect(providerReturnError(new URLSearchParams("code=abc"), new URLSearchParams())).toBeNull();
    for (const m of Object.values(GOOGLE_MESSAGES)) expect(m).not.toMatch(/access_denied|server_error|_/);
  });
});

describe("same e-mail => same account", () => {
  test("e-mail code user u1 later returns via Google as u1: no second provisioning, identity saved for u1", async () => {
    // Fake Supabase: identities are linked by verified e-mail, so Google's session carries the SAME user id.
    const usersByEmail = new Map<string, string>([["pat@example.com", "u1"]]);
    const googleSessionFor = (email: string) => ({ user: { id: usersByEmail.get(email)! } });
    const provision = mock(async (_n: string) => ({ ok: true as const }));
    const saveIdentity = mock(async (_s: unknown) => {});
    const store = new Map([["projexa_pending_org_name", "Acme"]]);
    const r = await runPostLogin({
      getSession: async () => googleSessionFor("pat@example.com"),
      hasMembership: async (id) => id === "u1",
      storage: { getItem: (k) => store.get(k) ?? null, removeItem: (k) => void store.delete(k) },
      provision, saveIdentity, messages: { genericError: "g", provisionError: "p" },
    });
    expect(r).toEqual({ ok: true });
    expect(provision).not.toHaveBeenCalled();
    expect((saveIdentity.mock.calls[0]![0] as { user: { id: string } }).user.id).toBe("u1");
    expect(usersByEmail.size).toBe(1);
  });
});
