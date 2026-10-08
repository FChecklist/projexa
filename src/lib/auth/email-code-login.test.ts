/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  LOCK_MS, MAX_WRONG_TRIES, MESSAGES, RESEND_AFTER_MS, cleanCodeInput, createEmailCodeLogin,
  type LoginDeps, type OtpType,
} from "./email-code-login";
import { safeRedirectPath } from "@/lib/safe-redirect";

// P1: the e-mailed-code sign-in, with every outside thing injected (no browser, no Supabase).
type VerifyAnswer = { ok: boolean; code?: string; message?: string; status?: number };
function setup(over: { online?: boolean; session?: boolean; identity?: boolean; verify?: (a: { token: string; type: OtpType }) => VerifyAnswer; otpError?: { message?: string; status?: number }; shellFails?: boolean } = {}) {
  const log: string[] = [];
  const store = new Map<string, string>();
  let t = 1_000_000;
  const online = over.online ?? true;
  const calls = { otp: [] as unknown[], verify: [] as { token: string; type: OtpType }[], shell: 0, after: 0 };
  const deps: LoginDeps = {
    auth: {
      async signInWithOtp(a) { calls.otp.push(a); log.push("otp"); return { error: over.otpError ?? null }; },
      async verifyOtp(a) {
        calls.verify.push({ token: a.token, type: a.type });
        const r = over.verify ? over.verify({ token: a.token, type: a.type }) : { ok: a.token === "123456" };
        return r.ok
          ? { data: { session: { user: { id: "u" } } }, error: null }
          : { data: { session: null }, error: { code: r.code, message: r.message ?? "Token has expired or is invalid", status: r.status } };
      },
      async getSession() { return { data: { session: over.session ? { user: { id: "u" } } : null } }; },
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    now: () => t,
    isOnline: () => online,
    startShellInstall: async () => { calls.shell += 1; log.push("shell"); if (over.shellFails) throw new Error("no worker"); },
    hasSavedIdentity: async () => Boolean(over.identity),
    afterVerified: async () => { calls.after += 1; log.push("after"); return { ok: true }; },
  };
  return { login: createEmailCodeLogin(deps), calls, log, advance: (ms: number) => { t += ms; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const bad: VerifyAnswer = { ok: false, code: "invalid_credentials", message: "Invalid login" };

describe("P1 e-mailed code sign-in", () => {
  test("new e-mail: signInWithOtp with shouldCreateUser true, then the code signs in (verifyOtp email) and finishing runs", async () => {
    const s = setup();
    expect(await s.login.start()).toBe("form");
    expect(await s.login.requestCode("  New@Example.com ")).toEqual({ ok: true });
    expect(s.calls.otp).toEqual([{ email: "new@example.com", options: { shouldCreateUser: true } }]);
    expect(await s.login.submitCode("new@example.com", "123456")).toEqual({ ok: true });
    expect(s.calls.verify).toEqual([{ token: "123456", type: "email" }]);
    expect(s.calls.after).toBe(1);
  });

  test("a not-yet-confirmed new user gets in under type signup after type email fails", async () => {
    const s = setup({ verify: (a) => ({ ok: a.type === "signup" }) });
    expect(await s.login.submitCode("a@b.co", "123456")).toEqual({ ok: true });
    expect(s.calls.verify.map((v) => v.type)).toEqual(["email", "signup"]);
  });

  test("a machine with a saved session opens straight in, no form", async () => {
    expect(await setup({ session: true }).login.start()).toBe("session");
  });

  test("offline with no saved identity: the connection sentence; offline with a saved identity: opens", async () => {
    expect(await setup({ online: false }).login.start()).toBe("offline_needs_connection");
    expect(await setup({ online: false, identity: true }).login.start()).toBe("session");
    const s = setup({ online: false });
    expect(await s.login.requestCode("a@b.co")).toEqual({ ok: false, notice: MESSAGES.needConnection });
    expect(s.calls.otp.length).toBe(0);
  });

  test("the shell install starts when the e-mail is submitted; the finish step (provisioning, identity, hence data copy) waits for a verified code", async () => {
    const s = setup();
    await s.login.requestCode("a@b.co");
    await flush();
    expect(s.calls.shell).toBe(1);
    expect(s.calls.after).toBe(0);
    await s.login.submitCode("a@b.co", "000000"); // wrong
    expect(s.calls.after).toBe(0);
    await s.login.submitCode("a@b.co", "123456");
    expect(s.log.indexOf("shell")).toBeLessThan(s.log.indexOf("after"));
    expect(s.calls.after).toBe(1);
  });

  test("a failing shell install never blocks the code", async () => {
    const s = setup({ shellFails: true });
    expect((await s.login.requestCode("a@b.co")).ok).toBe(true);
    await flush();
    expect((await s.login.submitCode("a@b.co", "123456")).ok).toBe(true);
  });

  test("wrong code and expired code each get their own plain message", async () => {
    const w = setup({ verify: () => bad });
    expect(await w.login.submitCode("a@b.co", "999999")).toEqual({ ok: false, notice: MESSAGES.wrongCode });
    const e = setup({ verify: () => ({ ok: false, code: "otp_expired", message: "OTP expired" }) });
    expect(await e.login.submitCode("a@b.co", "999999")).toEqual({ ok: false, notice: MESSAGES.expired });
  });

  test("only 6 digits are accepted (a 7th is cut, letters ignored, a short code is refused without costing a try)", async () => {
    expect(cleanCodeInput("12a3456789")).toBe("123456");
    const s = setup();
    expect(await s.login.submitCode("a@b.co", "12345")).toEqual({ ok: false, notice: MESSAGES.badShape });
    expect(s.calls.verify.length).toBe(0);
    await s.login.submitCode("a@b.co", "1234567");
    expect(s.calls.verify[0]!.token).toBe("123456");
  });

  test("5 wrong tries start a 15-minute pause (even the right code is refused), then it lifts", async () => {
    const s = setup({ verify: () => bad });
    for (let i = 0; i < MAX_WRONG_TRIES; i += 1) await s.login.submitCode("a@b.co", "111111");
    const sent = s.calls.verify.length;
    expect(sent).toBe(MAX_WRONG_TRIES * 2); // email + signup per try
    expect(await s.login.submitCode("a@b.co", "123456")).toEqual({ ok: false, notice: MESSAGES.tooMany });
    s.advance(LOCK_MS - 1);
    expect((await s.login.submitCode("a@b.co", "123456")).ok).toBe(false);
    expect(s.calls.verify.length).toBe(sent); // nothing was sent to the server while paused
    s.advance(2);
    await s.login.submitCode("a@b.co", "123456");
    expect(s.calls.verify.length).toBeGreaterThan(sent);
  });

  test("4 wrong tries do not pause", async () => {
    let good = false;
    const s = setup({ verify: () => ({ ...bad, ok: good }) });
    for (let i = 0; i < MAX_WRONG_TRIES - 1; i += 1) await s.login.submitCode("a@b.co", "111111");
    good = true;
    expect(await s.login.submitCode("a@b.co", "111111")).toEqual({ ok: true });
  });

  test("resend is refused for 60 seconds, then allowed", async () => {
    const s = setup();
    await s.login.requestCode("a@b.co");
    expect(s.login.resendInMs()).toBe(RESEND_AFTER_MS);
    expect(await s.login.requestCode("a@b.co", { resend: true })).toEqual({ ok: false, notice: MESSAGES.resendWait });
    expect(s.calls.otp.length).toBe(1);
    s.advance(RESEND_AFTER_MS);
    expect(await s.login.requestCode("a@b.co", { resend: true })).toEqual({ ok: true });
    expect(s.calls.otp.length).toBe(2);
  });

  test("the server rate limit is explained plainly", async () => {
    const s = setup({ otpError: { message: "For security purposes, you can only request this after 50 seconds", status: 429 } });
    expect(await s.login.requestCode("a@b.co")).toEqual({ ok: false, notice: MESSAGES.tooManyServer });
  });

  test("redirectTo and the invitation return are honoured only as same-origin paths", () => {
    expect(safeRedirectPath("/invite/abc123")).toBe("/invite/abc123");
    expect(safeRedirectPath("/projects?x=1")).toBe("/projects?x=1");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/login")).toBe("/dashboard");
    expect(safeRedirectPath(null)).toBe("/dashboard");
  });
});
