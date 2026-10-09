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

export type Step = { ok: true } | { ok: false; notice: string };

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
      if (!isValidEmail(email)) return { ok: false, notice: MESSAGES.badEmail };
      if (!deps.isOnline()) return { ok: false, notice: MESSAGES.needConnection };
      if (opts.resend && resendInMs() > 0) return { ok: false, notice: MESSAGES.resendWait };
      // The public app shell starts now, before the code is typed and without telling the person. Data copy does NOT start (rule D2).
      void Promise.resolve().then(() => deps.startShellInstall()).catch(() => {});
      const { error } = await deps.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) return { ok: false, notice: isRateLimited(error) ? MESSAGES.tooManyServer : MESSAGES.couldNotSend };
      lastSentAt = deps.now();
      return { ok: true };
    },

    async submitCode(emailRaw: string, codeRaw: string): Promise<Step> {
      const email = normaliseEmail(emailRaw);
      if (pauseLeftMs(deps, email) > 0) return { ok: false, notice: MESSAGES.tooMany };
      const token = cleanCodeInput(codeRaw);
      if (!isCodeShape(token)) return { ok: false, notice: MESSAGES.badShape };

      let result = await deps.auth.verifyOtp({ email, token, type: "email" });
      // A not-yet-confirmed new user's code is verified under type 'signup'.
      if (result.error && !isRateLimited(result.error)) {
        const second = await deps.auth.verifyOtp({ email, token, type: "signup" });
        if (!second.error) result = second;
      }
      if (result.error || !result.data.session) {
        const err: AuthErr = result.error ?? {};
        if (isRateLimited(err)) return { ok: false, notice: MESSAGES.tooManyServer };
        const tries = readLock(deps, email).tries + 1;
        if (tries >= MAX_WRONG_TRIES) {
          writeLock(deps, email, { tries, until: deps.now() + LOCK_MS });
          return { ok: false, notice: MESSAGES.tooMany };
        }
        writeLock(deps, email, { tries, until: null });
        return { ok: false, notice: isExpired(err) ? MESSAGES.expired : MESSAGES.wrongCode };
      }
      writeLock(deps, email, null);
      return deps.afterVerified(email);
    },
  };
}
