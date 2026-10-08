/// <reference types="bun-types" />
// P1: the /login page as a person uses it, rendered for real (happy-dom + testing-library) with the outside world faked: the Supabase auth client,
// the router, the translations (the real messages/en.json), and the local-first install pieces. The rules themselves (tries, pause, resend) are
// tested in src/lib/auth/email-code-login.test.ts; this file proves the PAGE wires them up: e-mail -> code box -> sixth digit submits -> in.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process (same guard as ScopeClient.test.tsx).
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import en from "../../../messages/en.json";

// loaded AFTER the DOM is registered (its `screen` binds to the global document at import time)
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

const push = mock((_href: string) => {});
const refresh = mock(() => {});
await mock.module("next/navigation", () => ({
  useRouter: () => ({ push, replace: () => {}, refresh, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/login",
}));

// the real English sentences, with {name} filled in like next-intl does
await mock.module("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars: Record<string, string | number> = {}) => {
    const table = ns.split(".").reduce<Record<string, unknown>>((o, k) => (o[k] ?? {}) as Record<string, unknown>, en as unknown as Record<string, unknown>);
    let s = String(table[key] ?? `${ns}.${key}`);
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  },
}));

let googleOn = false;
// the Supabase settings endpoint: external.google follows `googleOn`
globalThis.fetch = (async () => ({ ok: true, json: async () => ({ external: { google: googleOn } }) })) as unknown as typeof fetch;

const RIGHT_CODE = "123456";
let session: { user: { id: string } } | null = null;
const auth = {
  getSession: mock(async () => ({ data: { session } })),
  signInWithOtp: mock(async (_a: unknown) => ({ error: null as { message: string } | null })),
  signInWithOAuth: mock(async (_a: unknown) => ({ error: null as { message: string } | null })),
  verifyOtp: mock(async (a: { token: string }) => {
    if (a.token === RIGHT_CODE) {
      session = { user: { id: "user-1" } };
      return { data: { session }, error: null };
    }
    return { data: { session: null }, error: { message: "Token has expired or is invalid" } };
  }),
};
const memberships = { select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { organization_id: "org-1" } }) }) }) }) };
await mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth, from: () => memberships }) }));

const ensureServiceWorker = mock(async () => true);
const prewarmReleaseBundle = mock(async () => true);
await mock.module("@/lib/local-first/release/sw-client", () => ({ ensureServiceWorker }));
await mock.module("@/lib/local-first/release/prewarm", () => ({ prewarmReleaseBundle, takePrewarmedBundle: () => null }));
await mock.module("@/lib/local-first/identity", () => ({
  createIdentityStore: () => ({}),
  getDurableIdentity: async () => null,
  mirrorSession: async () => {},
}));
await mock.module("@/lib/local-first/device-meta", () => ({ openDeviceMeta: async () => ({}) }));
await mock.module("@/lib/px-api", () => ({ viaPxApi: async () => new Response("{}", { status: 200 }) }));

const { default: LoginPage } = await import("./page");

function setUrl(search: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`http://localhost:3000/login${search}`);
}

beforeEach(() => {
  session = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  googleOn = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  auth.signInWithOAuth.mockClear();
  setUrl("");
  push.mockClear();
  refresh.mockClear();
  ensureServiceWorker.mockClear();
  prewarmReleaseBundle.mockClear();
  auth.signInWithOtp.mockClear();
  auth.verifyOtp.mockClear();
  auth.getSession.mockClear();
});
afterEach(() => cleanup());

async function toCodeBox(email = "Pat@Example.com") {
  render(<LoginPage />);
  const emailBox = (await screen.findByLabelText(en.Auth.login.email)) as HTMLInputElement;
  fireEvent.change(emailBox, { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: en.Auth.login.submit }));
  return (await screen.findByLabelText(en.Auth.login.code)) as HTMLInputElement;
}

describe("P1 login page", () => {
  test("submitting the e-mail asks for a code (new addresses allowed), starts the public install, and shows the code box", async () => {
    const box = await toCodeBox();
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(auth.signInWithOtp.mock.calls[0]![0]).toEqual({ email: "pat@example.com", options: { shouldCreateUser: true } });
    // the public app shell + bundle start now (before the code) ...
    await waitFor(() => expect(ensureServiceWorker).toHaveBeenCalled());
    expect(prewarmReleaseBundle).toHaveBeenCalled();
    // ... but nothing was verified or entered yet
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(box.getAttribute("autocomplete")).toBe("one-time-code");
    expect(box.getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByText(/pat@example\.com/i)).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  test("the sixth digit submits by itself; five digits do not", async () => {
    const box = await toCodeBox();
    fireEvent.change(box, { target: { value: "12345" } });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: RIGHT_CODE } });
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledTimes(1));
    expect(auth.verifyOtp.mock.calls[0]![0]).toEqual({ email: "pat@example.com", token: RIGHT_CODE, type: "email" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  test("a wrong code gets a plain message, clears the box and goes nowhere", async () => {
    const box = await toCodeBox();
    fireEvent.change(box, { target: { value: "000000" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That code");
    await waitFor(() => expect(box.value).toBe(""));
    expect(push).not.toHaveBeenCalled();
  });

  test("a machine that already has a session goes straight in, without showing the e-mail form", async () => {
    session = { user: { id: "user-1" } };
    render(<LoginPage />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    // no code was asked for and no code box ever appeared
    expect(screen.queryByLabelText(en.Auth.login.code)).toBeNull();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  test("redirectTo is honoured for a same-origin path and refused for an outside address", async () => {
    setUrl("?redirectTo=%2Finvite%2Fabc123");
    let box = await toCodeBox();
    fireEvent.change(box, { target: { value: RIGHT_CODE } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/invite/abc123"));

    cleanup();
    session = null;
    push.mockClear();
    setUrl("?redirectTo=https%3A%2F%2Fevil.example%2Fx");
    box = await toCodeBox();
    fireEvent.change(box, { target: { value: RIGHT_CODE } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  test("an old password-reset link lands here with one plain sentence", async () => {
    setUrl("?notice=no-password");
    render(<LoginPage />);
    const note = await screen.findByTestId("login-notice");
    expect(note.textContent).toBe(en.Auth.login.noPassword);
  });

  test("Google: the button is hidden when the provider is off, shown when on, and the e-mail form stays the main flow", async () => {
    render(<LoginPage />);
    await screen.findByLabelText(en.Auth.login.email);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: en.Auth.login.google })).toBeNull();
    cleanup();
    window.sessionStorage.clear();
    googleOn = true;
    render(<LoginPage />);
    const btn = await screen.findByRole("button", { name: en.Auth.login.google });
    expect(screen.getByRole("button", { name: en.Auth.login.submit })).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(auth.signInWithOAuth.mock.calls[0]![0]).toEqual({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?redirectTo=%2Fdashboard` },
    });
  });

  test("Google: an outside redirectTo never reaches the provider call", async () => {
    googleOn = true;
    setUrl("?redirectTo=https%3A%2F%2Fevil.example%2Fx");
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole("button", { name: en.Auth.login.google }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalled());
    const rt = (auth.signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } }).options.redirectTo;
    expect(rt).toBe(`${window.location.origin}/auth/callback?redirectTo=%2Fdashboard`);
  });
});
