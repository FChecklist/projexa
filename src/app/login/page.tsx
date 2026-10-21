"use client";

// P1: the one door. E-mail -> 6-digit code by e-mail -> in. No password anywhere (see src/lib/auth/email-code-getLogin().ts for the rules).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createIdentityStore, getDurableIdentity } from "@/lib/local-first/identity";
import { openDeviceMeta } from "@/lib/local-first/device-meta";
import { prewarmReleaseBundle } from "@/lib/local-first/release/prewarm";
import { ensureServiceWorker } from "@/lib/local-first/release/sw-client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { postLoginDeps } from "@/lib/auth/post-login-deps";
import { runPostLogin } from "@/lib/auth/post-login";
import { isGoogleEnabled, startGoogleSignIn } from "@/lib/auth/google-signin";
import { CODE_LENGTH, cleanCodeInput, createEmailCodeLogin, suspectedEmailTypo, type AuthLike, type LoginDeps, type Step } from "@/lib/auth/email-code-login";
import { GuidedPanel, type PanelAction } from "@/components/GuidedPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { currentScreen } from "@/lib/error-guide/context";
import { diagnoseBrowser, type BrowserProblem } from "@/lib/browser-check";
import { BrowserNotice } from "@/components/BrowserNotice";

// GUIDED ERRORS: what went wrong on this page, as the facts the guide catalogue needs (g4-session-laptop.ts, "LOGIN_*" codes).
type Failure = { code: string; field?: "email" | "code"; detail?: string };
const failureOf = (r: Extract<Step, { ok: false }>): Failure => ({ code: r.code ?? "LOGIN_SEND_FAILED", field: r.field, detail: r.detail ?? (r.code ? undefined : r.notice) });

/** The guided panel for a sign-in failure, with the buttons that DO the fix here. A component of its own (it receives the page's handlers as props). */
function LoginFailure(props: { f: Failure; resendIn: number; loading: boolean; onResend: () => void; onTry: () => void; onRetrySetup: () => void; onRetryGoogle: () => void }) {
  const { f, resendIn, loading } = props;
  const screen = currentScreen();
  const actions: PanelAction[] = [];
  if (f.code === "LOGIN_CODE_WRONG" || f.code === "LOGIN_CODE_EXPIRED" || f.code === "LOGIN_LOCKED") {
    actions.push({ id: "resend", primary: true, label: resendIn > 0 ? `Send a new code (in ${Math.ceil(resendIn / 1000)}s)` : "Send a new code", disabled: loading || resendIn > 0 || f.code === "LOGIN_LOCKED", onClick: props.onResend });
  } else if (f.code === "LOGIN_SETUP_FAILED") {
    actions.push({ id: "retry", primary: true, label: "Try again", disabled: loading, onClick: props.onRetrySetup });
  } else if (f.code === "LOGIN_GOOGLE_FAILED") {
    actions.push({ id: "retry", primary: true, label: "Try again", onClick: props.onRetryGoogle });
  } else if (f.code === "LOGIN_RATE_LIMIT" || f.code === "LOGIN_SEND_FAILED" || f.code === "LOGIN_OFFLINE") {
    actions.push({ id: "retry", primary: true, label: "Try again", disabled: loading, onClick: props.onTry });
  }
  return (
    <GuidedPanel
      ctx={{ route: screen.route, search: screen.search, code: f.code, field: f.field, serverMessage: f.detail, status: f.code === "LOGIN_OFFLINE" ? 0 : undefined }}
      actions={actions}
      testId="login-guided-error"
    />
  );
}

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("Auth.login");
  // What was typed in the e-mail box survives a reload, a failed code and "Change e-mail" (kept for 2 hours in this tab only).
  const draft = useDraft("login", { email: "" });
  const email = draft.value.email;
  const setEmail = (v: string) => draft.set({ email: v });
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"checking" | "email" | "code" | "offline">("checking");
  const [error, setError] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleOn, setGoogleOn] = useState(false);
  // The page the person was on (from ?redirectTo=): said at the top, so "why am I here" is never a question.
  const [continueTo, setContinueTo] = useState<string | null>(null);
  // Read after the page is on screen (never during server rendering): cookies off, private mode, no local database, too-old browser.
  const [browserProblems, setBrowserProblems] = useState<BrowserProblem[]>([]);
  useEffect(() => { setBrowserProblems(diagnoseBrowser(window)); }, []);
  const submitting = useRef(false);

  // Built on first use in the browser (effects and handlers), never during server rendering: it reads window.localStorage.
  const loginRef = useRef<ReturnType<typeof createEmailCodeLogin> | null>(null);
  function getLogin() {
    if (loginRef.current) return loginRef.current;
    const supabase = createClient();
    const identityStore = () => createIdentityStore({ storage: window.localStorage, openMeta: () => openDeviceMeta() });
    const deps: LoginDeps = {
      auth: supabase.auth as unknown as AuthLike,
      storage: window.localStorage,
      now: Date.now,
      isOnline: () => navigator.onLine !== false,
      // Only PUBLIC build files: the service worker and the verified release bundle bytes (release/prewarm.ts). The organisation's data is copied after sign-in by WorkspacePrepare, never before.
      startShellInstall: () => Promise.all([ensureServiceWorker(), prewarmReleaseBundle()]),
      hasSavedIdentity: async () => Boolean(await getDurableIdentity(identityStore())),
      afterVerified: () => runPostLogin(postLoginDeps(supabase, identityStore, t)),
    };
    loginRef.current = createEmailCodeLogin(deps);
    return loginRef.current;
  }

  function goIn() {
    // AUDIT-100 B6/B56: back to where the person came from (an invitation link, a signed-in page), same-origin paths only.
    router.push(safeRedirectPath(new URLSearchParams(window.location.search).get("redirectTo")));
    router.refresh();
  }

  useEffect(() => {
    let alive = true;
    void getLogin().start().then((s) => {
      if (!alive) return;
      if (s === "session") goIn();
      else {
        // Old password-reset links land here with one plain sentence (there is no password any more).
        if (new URLSearchParams(window.location.search).get("notice") === "no-password") setNotice(t("noPassword"));
        const back = safeRedirectPath(new URLSearchParams(window.location.search).get("redirectTo"), "");
        if (back) setContinueTo(back.split(/[?#]/)[0] || back);
        setStage(s === "form" ? "email" : "offline");
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Continue with Google" appears only when this project has the Google provider switched on (checked once, never blocks the page).
  useEffect(() => {
    let alive = true;
    void isGoogleEnabled({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      fetch: (url, init) => fetch(url, init),
      isOnline: () => navigator.onLine !== false,
      session: window.sessionStorage,
    }).then((on) => { if (alive) setGoogleOn(on); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function continueWithGoogle() {
    setError(null);
    void Promise.resolve().then(() => Promise.all([ensureServiceWorker(), prewarmReleaseBundle()])).catch(() => {});
    const r = await startGoogleSignIn(createClient().auth as never, window.location.origin, new URLSearchParams(window.location.search).get("redirectTo"));
    if (!r.ok) setError({ code: "LOGIN_GOOGLE_FAILED", detail: r.notice });
  }

  // "Try again" after a good code whose last set-up step failed: the code is spent, so only the set-up step is repeated.
  async function retrySetup() {
    setError(null);
    setLoading(true);
    const r = await getLogin().finish(email);
    setLoading(false);
    if (!r.ok) { setError(failureOf(r)); return; }
    draft.clear();
    goIn();
  }

  useEffect(() => {
    if (stage !== "code") return;
    const id = setInterval(() => setResendIn(getLogin().resendInMs()), 1000);
    return () => clearInterval(id);
  }, [stage]);

  async function sendCode(e?: React.FormEvent, resend = false) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    const r = await getLogin().requestCode(email, { resend });
    setLoading(false);
    if (!r.ok) { setError(failureOf(r)); return; }
    setCode("");
    setResendIn(getLogin().resendInMs());
    setStage("code");
  }

  async function checkCode(value: string) {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setLoading(true);
    const r = await getLogin().submitCode(email, value);
    setLoading(false);
    submitting.current = false;
    if (!r.ok) { setError(failureOf(r)); setCode(""); return; }
    draft.clear();
    goIn();
  }

  function onCodeChange(raw: string) {
    const v = cleanCodeInput(raw);
    setCode(v);
    if (v.length === CODE_LENGTH) void checkCode(v);
  }

  const typo = stage === "code" ? suspectedEmailTypo(email) : null;
  const notArrived = stage === "code" && !error && resendIn === 0;
  const fieldError = (field: "email" | "code") => (error?.field === field ? error : null);

  const googleButton = googleOn && stage === "email" ? (
    <div className="mt-4 space-y-3">
      <p className="text-center text-xs text-px-muted">{t("orDivider")}</p>
      <Button type="button" variant="outline" className="w-full" onClick={() => void continueWithGoogle()}>
        <svg aria-hidden="true" viewBox="0 0 48 48" className="mr-2 h-4 w-4">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z" />
          <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        {t("google")}
      </Button>
    </div>
  ) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-px-concrete p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {stage === "offline" ? (
            <p data-testid="login-offline" className="text-sm">{t("needConnection")}</p>
          ) : stage === "code" ? (
            <form onSubmit={(e) => { e.preventDefault(); void checkCode(code); }} className="space-y-4">
              <p className="text-sm text-px-muted">{t("codeSent", { email })}</p>
              {typo && (
                <GuidedPanel
                  ctx={{ route: "/login", search: "", code: "LOGIN_EMAIL_TYPO", field: "email", serverMessage: `@${typo.typed} (did you mean @${typo.meant}?)` }}
                  actions={[{ id: "change", primary: true, label: "Change e-mail", onClick: () => { setStage("email"); setError(null); } }]}
                  testId="login-typo"
                />
              )}
              <div className="space-y-1.5">
                <Label htmlFor="code">{t("code")}</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={CODE_LENGTH * 2} required autoFocus value={code} aria-invalid={fieldError("code") ? true : undefined} aria-describedby={fieldError("code") ? "code-error" : undefined} onChange={(e) => onCodeChange(e.target.value)} />
                {fieldError("code") && <p id="code-error" data-testid="login-code-error" className="text-xs text-px-error">This code is not accepted. The steps are below.</p>}
              </div>
              {error && <LoginFailure f={error} resendIn={resendIn} loading={loading} onResend={() => void sendCode(undefined, true)} onTry={() => void sendCode(undefined, stage === "code")} onRetrySetup={() => void retrySetup()} onRetryGoogle={() => void continueWithGoogle()} />}
              {notArrived && (
                <GuidedPanel
                  ctx={{ route: "/login", search: "", code: "LOGIN_CODE_NOT_ARRIVED", serverMessage: email }}
                  actions={[{ id: "resend", primary: true, label: "Send a new code", disabled: loading, onClick: () => void sendCode(undefined, true) }]}
                  testId="login-not-arrived"
                  noCopy
                />
              )}
              <Button type="submit" className="w-full" disabled={loading || code.length !== CODE_LENGTH}>{loading ? t("submitting") : t("verify")}</Button>
              <p className="text-center text-sm">
                <button type="button" className="text-px-muted underline disabled:no-underline disabled:opacity-60" disabled={loading || resendIn > 0} onClick={() => void sendCode(undefined, true)}>
                  {resendIn > 0 ? t("resendIn", { seconds: Math.ceil(resendIn / 1000) }) : t("resend")}
                </button>
                {" · "}
                <button id="change-email" type="button" className="text-px-muted underline" onClick={() => { setStage("email"); setError(null); }}>{t("changeEmail")}</button>
              </p>
            </form>
          ) : (
            <form onSubmit={(e) => void sendCode(e)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("email")}</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} aria-invalid={fieldError("email") ? true : undefined} aria-describedby={fieldError("email") ? "email-error" : undefined} onChange={(e) => setEmail(e.target.value)} />
                {fieldError("email") && <p id="email-error" data-testid="login-email-error" className="text-xs text-px-error">{error?.code === "LOGIN_EMAIL_EMPTY" ? "Type your e-mail here." : "This e-mail is not complete."}</p>}
              </div>
              {browserProblems.length > 0 && <BrowserNotice problems={browserProblems} />}
              {notice && <p data-testid="login-notice" className="text-sm">{notice}</p>}
              {continueTo && (
                <GuidedPanel ctx={{ route: "/login", search: "", code: "SESSION_ENDED_LOGIN", serverMessage: continueTo }} noCopy testId="login-continue" />
              )}
              <p className="text-sm text-px-muted">{t("intro")}</p>
              {error && <LoginFailure f={error} resendIn={resendIn} loading={loading} onResend={() => void sendCode(undefined, true)} onTry={() => void sendCode(undefined, false)} onRetrySetup={() => void retrySetup()} onRetryGoogle={() => void continueWithGoogle()} />}
              <Button type="submit" className="w-full" disabled={loading || stage === "checking"}>{loading ? t("submitting") : t("submit")}</Button>
            </form>
          )}
          {googleButton}
        </CardContent>
      </Card>
    </div>
  );
}
