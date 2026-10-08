/// <reference types="bun-types" />
// P1c: the Google return (/auth/callback?code=...) runs the SAME post-login steps as a verified e-mail code (src/lib/auth/post-login.ts),
// honours redirectTo only for same-origin paths, and explains a cancelled Google sign-in in one plain sentence.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
const { cleanup, render, screen, waitFor } = await import("@testing-library/react");

const replace = mock((_h: string) => {});
await mock.module("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace, refresh: () => {}, prefetch: () => {} }) }));
const session = { user: { id: "u1" } };
const auth = {
  exchangeCodeForSession: mock(async (_c: string) => ({ error: null })),
  getSession: mock(async () => ({ data: { session } })),
  setSession: async () => ({ error: null }), verifyOtp: async () => ({ error: null }),
};
await mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth, from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }));
const mirrorSession = mock(async (_s: unknown, _x: unknown) => {});
await mock.module("@/lib/local-first/identity", () => ({ createIdentityStore: () => ({}), getDurableIdentity: async () => null, mirrorSession }));
await mock.module("@/lib/local-first/device-meta", () => ({ openDeviceMeta: async () => ({}) }));
const ensureServiceWorker = mock(async () => true);
await mock.module("@/lib/local-first/release/sw-client", () => ({ ensureServiceWorker }));
await mock.module("@/lib/local-first/release/prewarm", () => ({ prewarmReleaseBundle: async () => true, takePrewarmedBundle: () => null }));
const viaPxApi = mock(async (_u: string, _i?: unknown) => new Response("{}", { status: 200 }));
await mock.module("@/lib/px-api", () => ({ viaPxApi }));

const { default: CallbackPage } = await import("./page");
const setUrl = (qs: string) => (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`http://localhost:3000/auth/callback${qs}`);

beforeEach(() => {
  window.localStorage.clear();
  replace.mockClear(); mirrorSession.mockClear(); viaPxApi.mockClear(); auth.exchangeCodeForSession.mockClear(); ensureServiceWorker.mockClear();
});
afterEach(() => cleanup());

describe("Google return through /auth/callback", () => {
  test("exchanges the code, runs the shared post-login steps (provision, identity save, shell install) and goes to the safe redirectTo", async () => {
    window.localStorage.setItem("projexa_pending_org_name", "Acme");
    setUrl("?code=abc&redirectTo=%2Finvite%2Fx1");
    render(<CallbackPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/invite/x1"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(viaPxApi).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("projexa_pending_org_name")).toBeNull();
    expect(mirrorSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ensureServiceWorker).toHaveBeenCalled());
  });
  test("an outside redirectTo falls back to /dashboard", async () => {
    setUrl("?code=abc&redirectTo=https%3A%2F%2Fevil.example%2Fx");
    render(<CallbackPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
  test("cancelled at Google: one plain sentence, no raw code, no sign-in attempt", async () => {
    setUrl("?error=access_denied&error_code=bad&error_description=User+denied+access");
    render(<CallbackPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("cancelled");
    expect(alert.textContent).not.toContain("access_denied");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
