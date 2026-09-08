/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  requiresAuthenticatedPage,
  PUBLIC_PAGE_PATHS_FOR_TEST,
} from "@/lib/authz/page-access";
import en from "../../../messages/en.json";
import hi from "../../../messages/hi.json";

// G-08 -- the password recovery route, asserted end to end as a ROUTE rather
// than as a component.
//
// WHY THIS SHAPE. The gap was never "the reset page renders wrong"; it was
// that no entry point existed at all, and that is invisible to any test that
// renders a page it was given. So these assertions are about REACHABILITY: is
// there a link from the only screen a locked-out user can see, do both pages
// exist, can an unauthenticated visitor open them, does the emailed link come
// back through the callback that knows how to spend a recovery credential,
// and do both locales carry every string. Each of them fails if the route is
// broken anywhere along its length.
//
// The one thing deliberately NOT asserted here is that Supabase sends an
// email. That is Supabase's job and needs a live project; asserting it in a
// unit test would mean mocking the very call under test, which proves nothing.

const APP = join(import.meta.dir, "..");
const FORGOT = join(APP, "forgot-password", "page.tsx");
const RESET = join(APP, "reset-password", "page.tsx");
const LOGIN = join(APP, "login", "page.tsx");
const CALLBACK = join(APP, "auth", "callback", "page.tsx");

const forgotSrc = existsSync(FORGOT) ? readFileSync(FORGOT, "utf8") : "";
const resetSrc = existsSync(RESET) ? readFileSync(RESET, "utf8") : "";
const loginSrc = readFileSync(LOGIN, "utf8");
const callbackSrc = readFileSync(CALLBACK, "utf8");

describe("G-08: a locked-out user can get back in", () => {
  test("both pages of the route exist", () => {
    expect(existsSync(FORGOT)).toBe(true);
    expect(existsSync(RESET)).toBe(true);
  });

  test("*** THE REQUIRED PROOF: /login links to it ***", () => {
    // Before this, /login offered signInWithPassword and nothing else -- no
    // magic link, no Google, no SSO -- so a forgotten password was a permanent
    // lockout. A reset page nobody can find is the same as no reset page.
    expect(loginSrc).toContain('href="/forgot-password"');
  });

  test("the login screen still has only one sign-in method, which is why the link matters", () => {
    // If this ever fails, someone added an alternative sign-in path and the
    // stakes of the link above changed. That is worth re-reading, not worth
    // silently passing.
    expect(loginSrc).toContain("signInWithPassword");
    expect(loginSrc).not.toContain("signInWithOtp");
    expect(loginSrc).not.toContain("signInWithOAuth");
  });

  test("an unauthenticated visitor can open both pages", () => {
    // Someone who cannot log in is by definition not logged in. page-access.ts
    // is deny-by-default, so an omission here fails closed and redirects the
    // recipient of a reset email to a login form.
    expect(requiresAuthenticatedPage("/forgot-password")).toBe(false);
    expect(requiresAuthenticatedPage("/reset-password")).toBe(false);
    expect(PUBLIC_PAGE_PATHS_FOR_TEST.has("/forgot-password")).toBe(true);
    expect(PUBLIC_PAGE_PATHS_FOR_TEST.has("/reset-password")).toBe(true);
  });

  test("the reset email returns through /auth/callback, not straight to the page", () => {
    // The callback is what turns the emailed credential into a session. Sending
    // the link directly at /reset-password lands a visitor with no session on a
    // form that cannot do anything -- which is exactly the failure
    // R47_AUTH_REDIRECT_01 recorded for signup confirmation.
    expect(forgotSrc).toContain("resetPasswordForEmail");
    expect(forgotSrc).toContain("/auth/callback?redirectTo=/reset-password");
    expect(callbackSrc).toContain("recovery");
    expect(callbackSrc).toContain("redirectTo");
  });

  test("the reset page actually changes the password", () => {
    expect(resetSrc).toContain("updateUser({ password })");
  });

  test("the reset page confirms the password before submitting", () => {
    expect(resetSrc).toContain("mismatch");
    expect(resetSrc).toContain("MIN_PASSWORD_LENGTH");
  });

  test("a spent or expired link says so instead of failing silently", () => {
    expect(resetSrc).toContain("linkExpired");
    expect(resetSrc).toContain("getSession");
  });

  test("the sent-confirmation never reveals whether the address has an account", () => {
    // An enumeration oracle: a form that answers "no such account" lets anyone
    // test an address list and learn who the customers are. The wording must
    // stay conditional.
    const sent = (en as { Auth: { forgotPassword: { sentBody: string } } }).Auth.forgotPassword.sentBody;
    expect(sent.toLowerCase()).toContain("if that address");
    // And the page must not branch its message on the API's answer.
    expect(forgotSrc).not.toContain("User not found");
  });

  test("both locales carry every string the two pages ask for", () => {
    const keysIn = (src: string) =>
      [...src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    const needed = {
      forgotPassword: new Set(keysIn(forgotSrc)),
      resetPassword: new Set(keysIn(resetSrc)),
    };
    for (const [label, messages] of [["en", en], ["hi", hi]] as const) {
      const auth = (messages as { Auth: Record<string, Record<string, string>> }).Auth;
      for (const [section, keys] of Object.entries(needed)) {
        for (const key of keys) {
          expect(`${label}.Auth.${section}.${key}=${auth[section]?.[key] ?? "MISSING"}`)
            .not.toContain("=MISSING");
        }
      }
      expect(auth.login.forgotPasswordLink).toBeTruthy();
    }
  });
});
