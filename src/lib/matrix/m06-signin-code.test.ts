import { describe, expect, test } from "bun:test";
import {
  CODE_LENGTH, LOCK_MS, MAX_WRONG_TRIES, MESSAGES, RESEND_AFTER_MS, cleanCodeInput, createEmailCodeLogin, isCodeShape, isValidEmail,
  normaliseEmail, pauseLeftMs, type AuthLike, type LoginDeps,
} from "@/lib/auth/email-code-login";

// MATRIX category 6: sign-in by the e-mailed 6-digit code (local stub auth only, no network). Cases M06-01 ... M06-27.
// The stub Auth accepts one fixed code, like e2e/support/sign-in.ts's stubAuthOtp; "expired" and "other machine" are modelled by
// the answers the stub gives.

const GOOD = "123456";
type Known = "new" | "existing";
function world(o: { online?: boolean; known?: Known; savedIdentity?: boolean; session?: boolean; expireAll?: boolean; sendError?: { status?: number; message?: string } } = {}) {
  const store = new Map<string, string>();
  const clock = { t: 1_800_000_000_000 };
  const calls = { send: 0, verify: [] as string[], shell: 0, after: 0 };
  const online = o.online ?? true;
  const auth: AuthLike = {
    async signInWithOtp() { calls.send++; return { error: o.sendError ?? null }; },
    async verifyOtp({ token, type }) {
      calls.verify.push(type);
      if (o.expireAll) return { data: { session: null }, error: { message: "Token has expired or is invalid", code: "otp_expired" } };
      if (token !== GOOD) return { data: { session: null }, error: { message: "Token is invalid" } };
      // an unconfirmed brand-new user is verified under 'signup', an existing one under 'email'
      if ((o.known ?? "existing") === "new" && type === "email") return { data: { session: null }, error: { message: "invalid" } };
      return { data: { session: { access: "x" } }, error: null };
    },
    async getSession() { return { data: { session: o.session ? {} : null } }; },
  };
  const deps: LoginDeps = {
    auth, now: () => clock.t, isOnline: () => online,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    startShellInstall: async () => { calls.shell++; },
    hasSavedIdentity: async () => o.savedIdentity ?? false,
    afterVerified: async () => { calls.after++; return { ok: true }; },
  };
  return { deps, clock, calls, store, login: createEmailCodeLogin(deps) };
}

describe("M06 sign-in by e-mailed code", () => {
  test("M06-01 new e-mail: send then verify under 'signup' lets them in", async () => {
    const w = world({ known: "new" });
    expect((await w.login.requestCode("new@x.com")).ok).toBe(true);
    expect((await w.login.submitCode("new@x.com", GOOD)).ok).toBe(true);
    expect(w.calls.verify).toEqual(["email", "signup"]);
    expect(w.calls.after).toBe(1);
  });
  test("M06-02 existing e-mail: verified on the first 'email' try, no second call", async () => {
    const w = world();
    await w.login.requestCode("a@x.com");
    expect((await w.login.submitCode("a@x.com", GOOD)).ok).toBe(true);
    expect(w.calls.verify).toEqual(["email"]);
  });
  test("M06-03 wrong code: plain wrong-code notice, afterVerified never runs", async () => {
    const w = world();
    const r = await w.login.submitCode("a@x.com", "000000");
    expect(r).toEqual({ ok: false, notice: MESSAGES.wrongCode });
    expect(w.calls.after).toBe(0);
  });
  test("M06-04 expired code is explained as expired, not as wrong", async () => {
    const w = world({ expireAll: true });
    expect(await w.login.submitCode("a@x.com", GOOD)).toEqual({ ok: false, notice: MESSAGES.expired });
  });
  test("M06-05 resend before 60s is refused and sends nothing", async () => {
    const w = world();
    await w.login.requestCode("a@x.com");
    w.clock.t += RESEND_AFTER_MS - 1;
    expect(await w.login.requestCode("a@x.com", { resend: true })).toEqual({ ok: false, notice: MESSAGES.resendWait });
    expect(w.calls.send).toBe(1);
  });
  test("M06-06 resend at exactly 60s is allowed", async () => {
    const w = world();
    await w.login.requestCode("a@x.com");
    w.clock.t += RESEND_AFTER_MS;
    expect((await w.login.requestCode("a@x.com", { resend: true })).ok).toBe(true);
    expect(w.calls.send).toBe(2);
  });
  test("M06-07 resendInMs counts down and reaches 0", async () => {
    const w = world();
    expect(w.login.resendInMs()).toBe(0);
    await w.login.requestCode("a@x.com");
    expect(w.login.resendInMs()).toBe(RESEND_AFTER_MS);
    w.clock.t += 20_000;
    expect(w.login.resendInMs()).toBe(RESEND_AFTER_MS - 20_000);
    w.clock.t += RESEND_AFTER_MS;
    expect(w.login.resendInMs()).toBe(0);
  });
  test("M06-08 offline on a machine with no saved identity: needs a connection, nothing is sent", async () => {
    const w = world({ online: false });
    expect(await w.login.start()).toBe("offline_needs_connection");
    expect(await w.login.requestCode("a@x.com")).toEqual({ ok: false, notice: MESSAGES.needConnection });
    expect(w.calls.send).toBe(0);
  });
  test("M06-09 offline on a machine that signed in before opens straight in, no code", async () => {
    expect(await world({ online: false, savedIdentity: true }).login.start()).toBe("session");
  });
  test("M06-10 other machine (no session, no identity, online) gets the e-mail form", async () => {
    expect(await world().login.start()).toBe("form");
  });
  test("M06-11 a saved session opens straight in even when online", async () => {
    expect(await world({ session: true }).login.start()).toBe("session");
  });
  test("M06-12 five wrong tries start a 15-minute pause, and even the RIGHT code is refused during it", async () => {
    const w = world();
    for (let i = 0; i < MAX_WRONG_TRIES; i++) await w.login.submitCode("a@x.com", "000000");
    expect(pauseLeftMs(w.deps, "a@x.com")).toBe(LOCK_MS);
    expect(await w.login.submitCode("a@x.com", GOOD)).toEqual({ ok: false, notice: MESSAGES.tooMany });
    expect(w.calls.after).toBe(0);
  });
  test("M06-13 four wrong tries do not lock; the right code on try five still works", async () => {
    const w = world();
    for (let i = 0; i < MAX_WRONG_TRIES - 1; i++) await w.login.submitCode("a@x.com", "000000");
    expect(pauseLeftMs(w.deps, "a@x.com")).toBe(0);
    expect((await w.login.submitCode("a@x.com", GOOD)).ok).toBe(true);
  });
  test("M06-14 the pause ends after 15 minutes", async () => {
    const w = world();
    for (let i = 0; i < MAX_WRONG_TRIES; i++) await w.login.submitCode("a@x.com", "000000");
    w.clock.t += LOCK_MS + 1;
    expect(pauseLeftMs(w.deps, "a@x.com")).toBe(0);
    expect((await w.login.submitCode("a@x.com", GOOD)).ok).toBe(true);
  });
  test("M06-15 the pause survives a reload (kept in storage, new login object)", async () => {
    const w = world();
    for (let i = 0; i < MAX_WRONG_TRIES; i++) await w.login.submitCode("a@x.com", "000000");
    const reloaded = createEmailCodeLogin(w.deps);
    expect(await reloaded.submitCode("a@x.com", GOOD)).toEqual({ ok: false, notice: MESSAGES.tooMany });
  });
  test("M06-16 the pause is per address, and case/space-insensitive for the same address", async () => {
    const w = world();
    for (let i = 0; i < MAX_WRONG_TRIES; i++) await w.login.submitCode("A@X.com ", "000000");
    expect(pauseLeftMs(w.deps, "a@x.com")).toBe(LOCK_MS);
    expect(pauseLeftMs(w.deps, "b@x.com")).toBe(0);
  });
  test("M06-17 a success clears the wrong-try counter", async () => {
    const w = world();
    for (let i = 0; i < 3; i++) await w.login.submitCode("a@x.com", "000000");
    await w.login.submitCode("a@x.com", GOOD);
    for (let i = 0; i < MAX_WRONG_TRIES - 1; i++) await w.login.submitCode("a@x.com", "000000");
    expect(pauseLeftMs(w.deps, "a@x.com")).toBe(0);
  });
  test.each(["", "12345", "1234567", "12 456", "abcdef", "12-456"])("M06-18 bad shape %p", async (c) => {
    const w = world();
    const r = await w.login.submitCode("a@x.com", c);
    if (cleanCodeInput(c).length === CODE_LENGTH) {
      expect(w.calls.verify.length).toBeGreaterThan(0); // pasted junk is cleaned to the first 6 digits and goes to the server
    } else {
      expect(r.ok).toBe(false);
      expect(r).toEqual({ ok: false, notice: MESSAGES.badShape });
      expect(w.calls.verify).toEqual([]);
    }
  });
  test("M06-19 a pasted code with spaces and newline is cleaned to digits and accepted", async () => {
    const w = world();
    expect(cleanCodeInput(" 123 456\n")).toBe(GOOD);
    expect((await w.login.submitCode("a@x.com", " 123 456\n")).ok).toBe(true);
  });
  test.each(["", "nope", "a@", "@x.com", "a b@x.com", "a@x"])("M06-20 bad e-mail %p is refused, nothing sent", async (e) => {
    const w = world();
    expect(await w.login.requestCode(e)).toEqual({ ok: false, notice: MESSAGES.badEmail });
    expect(w.calls.send).toBe(0);
    expect(isValidEmail(e)).toBe(false);
  });
  test("M06-21 server rate limit on send says 'too many requests', other send errors say 'could not send'", async () => {
    expect(await world({ sendError: { status: 429 } }).login.requestCode("a@x.com")).toEqual({ ok: false, notice: MESSAGES.tooManyServer });
    expect(await world({ sendError: { message: "For security purposes, you can only request this after 50 seconds" } }).login.requestCode("a@x.com")).toEqual({ ok: false, notice: MESSAGES.tooManyServer });
    expect(await world({ sendError: { message: "boom" } }).login.requestCode("a@x.com")).toEqual({ ok: false, notice: MESSAGES.couldNotSend });
  });
  test("M06-22 requesting a code starts the public shell install, a failed send does not set the resend timer", async () => {
    const w = world({ sendError: { message: "boom" } });
    await w.login.requestCode("a@x.com");
    await Promise.resolve(); await Promise.resolve();
    expect(w.calls.shell).toBe(1);
    expect(w.login.resendInMs()).toBe(0);
  });
  test("M06-23 a throwing shell install never breaks the send", async () => {
    const w = world();
    w.deps.startShellInstall = async () => { throw new Error("sw blocked"); };
    expect((await w.login.requestCode("a@x.com")).ok).toBe(true);
  });
  test("M06-24 normalisation trims and lower-cases", () => {
    expect(normaliseEmail("  Raj@Example.COM ")).toBe("raj@example.com");
  });
  test("M06-25 blocked storage never crashes a wrong try", async () => {
    const w = world();
    w.deps.storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(await w.login.submitCode("a@x.com", "000000")).toEqual({ ok: false, notice: MESSAGES.wrongCode });
  });
  test("M06-26 afterVerified failure is passed back as the notice", async () => {
    const w = world();
    w.deps.afterVerified = async () => ({ ok: false, notice: "Could not set up your workspace." });
    expect(await w.login.submitCode("a@x.com", GOOD)).toEqual({ ok: false, notice: "Could not set up your workspace." });
  });
  test("M06-27 server rate limit on verify is not counted as a wrong try", async () => {
    const w = world();
    w.deps.auth = { ...w.deps.auth, verifyOtp: async () => ({ data: { session: null }, error: { status: 429, message: "rate" } }) };
    for (let i = 0; i < MAX_WRONG_TRIES + 2; i++) expect(await w.login.submitCode("a@x.com", GOOD)).toEqual({ ok: false, notice: MESSAGES.tooManyServer });
    expect(pauseLeftMs(w.deps, "a@x.com")).toBe(0);
  });
});
