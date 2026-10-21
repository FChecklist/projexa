// P1 (owner's sign-in design, 2026-10-08): ONE door, no password. A person types an e-mail, gets a 6-digit code by e-mail, types it, and is in.
// New e-mail, new machine and "forgot" are all the same flow; a machine that already signed in keeps its session and opens straight in.
//
// This module holds the logic with every outside thing injected (Supabase auth, the shell installer, storage, clock), so the page is thin and
// the rules are testable without a browser:
//   - requestCode(): signInWithOtp({ shouldCreateUser: true }) AND, in the same moment, the PUBLIC app shell starts installing in the background
//     (service worker registration; nothing is announced). Organisation DATA is never touched here (rule D2: otherwise anyone typing a company's
//     address would receive its data). The release bundle download and the data copy start only after a session exists (WorkspacePrepare,
//     which needs the session's access token for the release registry anyway).
//   - submitCode(): verifyOtp type 'email', then 'signup' (a not-yet-confirmed new user's code is verified under that type).
//   - Safety: 6 digits only; at most MAX_WRONG_TRIES wrong tries, then a 15-minute pause enforced HERE (kept in storage so a reload does not clear
//     it); resend only after 60 seconds. Supabase enforces its own rate limit as well. The code lifetime (single use, 10 minutes) is a Supabase
//     Auth project setting ("Email OTP expiration" = 600 seconds) changed at the project level, NOT here: this module only explains an expired
//     code in plain English. HANDOVER: set that in the Supabase dashboard (Auth > Providers > Email) and make the e-mail template show {{ .Token }}.

export const CODE_LENGTH = 6;
export const MAX_WRONG_TRIES = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const RESEND_AFTER_MS = 60 * 1000;
export const LOCK_KEY = "px-code-lock-v1";

export const MESSAGES = {
  badEmail: "Please type a valid email address.",
  needConnection: "You need a connection for the first sign-in on this machine, because the code is sent by email.",
  wrongCode: "That code is not right. Check the email and try again.",
  badShape: "The code has 6 digits. Please type all 6.",
  expired: "That code did not work. Check the digits, or ask for a new one (a code lasts 10 minutes and works once).",
  tooMany: "Too many wrong tries. Please wait 15 minutes, then ask for a new code.",
  tooManyServer: "Too many requests. Please wait a few minutes and try again.",
  resendWait: "You can ask for a new code in a minute.",
  couldNotSend: "We could not send the code. Please check the address and try again.",
} as const;

export type OtpType = "email" | "signup";
type AuthErr = { message?: string; status?: number; code?: string };
export type AuthLike = {
  signInWithOtp(args: { email: string; options: { shouldCreateUser: boolean } }): Promise<{ error: AuthErr | null }>;
  verifyOtp(args: { email: string; token: string; type: OtpType }): Promise<{ data: { session: unknown | null }; error: AuthErr | null }>;
  getSession(): Promise<{ data: { session: unknown | null } }>;
};
export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export type LoginDeps = {
  auth: AuthLike;
  storage: StorageLike | null;
  now: () => number;
  isOnline: () => boolean;
  /** Registers the public app shell (service worker) in the background. Must not touch organisation data. Failures are swallowed. */
  startShellInstall: () => Promise<unknown>;
  /** True when this machine has a saved identity (a previous sign-in), so it can open its local copy with no code. */
  hasSavedIdentity: () => Promise<boolean>;
  /** After a verified code: organisation provisioning + saving the identity on this machine. Runs only once a session exists. */
  afterVerified: (email: string) => Promise<{ ok: true } | { ok: false; notice: string }>;
};

/**
 * GUIDED ERRORS: a refusal carries, besides the plain sentence (`notice`), the facts the guide catalogue needs (src/lib/error-guide/catalogue/
 * g4-session-laptop.ts): a `code`, the `field` it is about, and a short `detail` that fills the guide's {serverMessage} (tries left, minutes left).
 */
export type LoginCode =
  | "LOGIN_EMAIL_EMPTY" | "LOGIN_EMAIL_BAD" | "LOGIN_CODE_SHORT" | "LOGIN_CODE_WRONG" | "LOGIN_CODE_EXPIRED" | "LOGIN_LOCKED"
  | "LOGIN_RATE_LIMIT" | "LOGIN_SEND_FAILED" | "LOGIN_OFFLINE" | "LOGIN_RESEND_WAIT" | "LOGIN_SETUP_FAILED";
export type Step = { ok: true } | { ok: false; notice: string; code?: LoginCode; field?: "email" | "code"; detail?: string };

/** Common mistypings of well-known e-mail services; a code sent there never arrives (and may reach a stranger). */
const KNOWN_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "yahoo.co.in", "rediffmail.com", "live.com"];
const TYPO_OF: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gamil.com": "gmail.com", "gmail.cm": "gmail.com", "gmaill.com": "gmail.com", "gmail.in": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com", "yhoo.com": "yahoo.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com", "outllok.com": "outlook.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com",
  "iclod.com": "icloud.com", "icloud.con": "icloud.com",
};
/** The well-known service this address was probably meant for (e.g. "gmail.com" for "name@gmial.com"), or null when it looks fine. */
export function suspectedEmailTypo(emailRaw: string): { typed: string; meant: string } | null {
  const email = emailRaw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1);
  if (KNOWN_DOMAINS.includes(domain)) return null;
  const meant = TYPO_OF[domain];
  return meant ? { typed: domain, meant } : null;
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normaliseEmail(email));
export const isCodeShape = (code: string) => new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
/** Keeps digits only and at most CODE_LENGTH of them (what the code box shows as the person types or pastes). */
export const cleanCodeInput = (raw: string) => raw.replace(/\D/g, "").slice(0, CODE_LENGTH);

type Lock = { tries: number; until: number | null };

function readLock(deps: LoginDeps, email: string): Lock {
  try {
    const all = JSON.parse(deps.storage?.getItem(LOCK_KEY) ?? "{}") as Record<string, Lock>;
    const l = all[normaliseEmail(email)];
    if (l && typeof l.tries === "number") return { tries: l.tries, until: typeof l.until === "number" ? l.until : null };
  } catch { /* unreadable: start clean */ }
  return { tries: 0, until: null };
}
function writeLock(deps: LoginDeps, email: string, lock: Lock | null) {
  try {
    const all = JSON.parse(deps.storage?.getItem(LOCK_KEY) ?? "{}") as Record<string, Lock>;
    if (lock) all[normaliseEmail(email)] = lock;
    else delete all[normaliseEmail(email)];
    deps.storage?.setItem(LOCK_KEY, JSON.stringify(all));
  } catch { /* storage blocked: the server's own limit still applies */ }
}

/** Milliseconds left of a 15-minute pause for this address, or 0. */
export function pauseLeftMs(deps: LoginDeps, email: string): number {
  const l = readLock(deps, email);
  return l.until && l.until > deps.now() ? l.until - deps.now() : 0;
}

/** "15 minutes", "1 minute", "less than a minute" -- for the pause message. */
export function minutesWords(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  return m <= 0 ? "less than a minute" : `${m} ${m === 1 ? "minute" : "minutes"}`;
}

const text = (e: AuthErr) => `${e.code ?? ""} ${e.message ?? ""}`;
const isRateLimited = (e: AuthErr) => e.status === 429 || /rate|too many|security purposes|over_email_send/i.test(text(e));
const isExpired = (e: AuthErr) => /expired/i.test(text(e));

export function createEmailCodeLogin(deps: LoginDeps) {
  let lastSentAt: number | null = null;

  function resendInMs(): number {
    return lastSentAt === null ? 0 : Math.max(0, lastSentAt + RESEND_AFTER_MS - deps.now());
  }

  return {
    resendInMs,

    /** "session": go in now (a saved session, or a saved identity while offline). "form": show the e-mail box. */
    async start(): Promise<"session" | "form" | "offline_needs_connection"> {
      try {
        const { data } = await deps.auth.getSession();
        if (data.session) return "session";
      } catch { /* fall through */ }
      if (!deps.isOnline()) {
        return (await deps.hasSavedIdentity().catch(() => false)) ? "session" : "offline_needs_connection";
      }
      return "form";
    },

    /** E-mail submitted (first send) or asked again (resend, only after 60 seconds). */
    async requestCode(emailRaw: string, opts: { resend?: boolean } = {}): Promise<Step> {
      const email = normaliseEmail(emailRaw);
      if (!email) return { ok: false, notice: MESSAGES.badEmail, code: "LOGIN_EMAIL_EMPTY", field: "email" };
      if (!isValidEmail(email)) return { ok: false, notice: MESSAGES.badEmail, code: "LOGIN_EMAIL_BAD", field: "email" };
      if (!deps.isOnline()) return { ok: false, notice: MESSAGES.needConnection, code: "LOGIN_OFFLINE" };
      if (opts.resend && resendInMs() > 0) return { ok: false, notice: MESSAGES.resendWait, code: "LOGIN_RESEND_WAIT", detail: `Try again in ${Math.ceil(resendInMs() / 1000)} seconds.` };
      // The public app shell starts now, before the code is typed and without telling the person. Data copy does NOT start (rule D2).
      void Promise.resolve().then(() => deps.startShellInstall()).catch(() => {});
      const { error } = await deps.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) return isRateLimited(error) ? { ok: false, notice: MESSAGES.tooManyServer, code: "LOGIN_RATE_LIMIT" } : { ok: false, notice: MESSAGES.couldNotSend, code: "LOGIN_SEND_FAILED" };
      lastSentAt = deps.now();
      return { ok: true };
    },

    /** After a good code whose set-up step failed: repeat ONLY the set-up step (the code is spent and must not be asked for again). */
    async finish(emailRaw: string): Promise<Step> {
      const done = await deps.afterVerified(normaliseEmail(emailRaw));
      return done.ok ? done : { ...done, code: "LOGIN_SETUP_FAILED", detail: done.notice };
    },

    async submitCode(emailRaw: string, codeRaw: string): Promise<Step> {
      const email = normaliseEmail(emailRaw);
      const paused = pauseLeftMs(deps, email);
      if (paused > 0) return { ok: false, notice: MESSAGES.tooMany, code: "LOGIN_LOCKED", field: "code", detail: minutesWords(paused) };
      const token = cleanCodeInput(codeRaw);
      if (!isCodeShape(token)) return { ok: false, notice: MESSAGES.badShape, code: "LOGIN_CODE_SHORT", field: "code" };

      let result = await deps.auth.verifyOtp({ email, token, type: "email" });
      // A not-yet-confirmed new user's code is verified under type 'signup'.
      if (result.error && !isRateLimited(result.error)) {
        const second = await deps.auth.verifyOtp({ email, token, type: "signup" });
        if (!second.error) result = second;
      }
      if (result.error || !result.data.session) {
        const err: AuthErr = result.error ?? {};
        if (isRateLimited(err)) return { ok: false, notice: MESSAGES.tooManyServer, code: "LOGIN_RATE_LIMIT" };
        const tries = readLock(deps, email).tries + 1;
        if (tries >= MAX_WRONG_TRIES) {
          writeLock(deps, email, { tries, until: deps.now() + LOCK_MS });
          return { ok: false, notice: MESSAGES.tooMany, code: "LOGIN_LOCKED", field: "code", detail: minutesWords(LOCK_MS) };
        }
        writeLock(deps, email, { tries, until: null });
        const left = MAX_WRONG_TRIES - tries;
        const detail = `You have ${left} ${left === 1 ? "try" : "tries"} left before a 15-minute pause.`;
        return isExpired(err)
          ? { ok: false, notice: MESSAGES.expired, code: "LOGIN_CODE_EXPIRED", field: "code", detail }
          : { ok: false, notice: MESSAGES.wrongCode, code: "LOGIN_CODE_WRONG", field: "code", detail };
      }
      writeLock(deps, email, null);
      const done = await deps.afterVerified(email);
      return done.ok ? done : { ...done, code: "LOGIN_SETUP_FAILED", detail: done.notice };
    },
  };
}
