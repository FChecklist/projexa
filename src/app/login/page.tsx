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
import { CODE_LENGTH, cleanCodeInput, createEmailCodeLogin, type AuthLike, type LoginDeps } from "@/lib/auth/email-code-login";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("Auth.login");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"checking" | "email" | "code" | "offline">("checking");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleOn, setGoogleOn] = useState(false);
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
    if (!r.ok) setError(r.notice);
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
    if (!r.ok) { setError(r.notice); return; }
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
    if (!r.ok) { setError(r.notice); setCode(""); return; }
    goIn();
  }

  function onCodeChange(raw: string) {
    const v = cleanCodeInput(raw);
    setCode(v);
    if (v.length === CODE_LENGTH) void checkCode(v);
  }

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
              <div className="space-y-1.5">
                <Label htmlFor="code">{t("code")}</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={CODE_LENGTH} required autoFocus value={code} onChange={(e) => onCodeChange(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-px-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || code.length !== CODE_LENGTH}>{loading ? t("submitting") : t("verify")}</Button>
              <p className="text-center text-sm">
                <button type="button" className="text-px-muted underline disabled:no-underline disabled:opacity-60" disabled={loading || resendIn > 0} onClick={() => void sendCode(undefined, true)}>
                  {resendIn > 0 ? t("resendIn", { seconds: Math.ceil(resendIn / 1000) }) : t("resend")}
                </button>
                {" · "}
                <button type="button" className="text-px-muted underline" onClick={() => { setStage("email"); setError(null); }}>{t("changeEmail")}</button>
              </p>
            </form>
          ) : (
            <form onSubmit={(e) => void sendCode(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("email")}</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {notice && <p data-testid="login-notice" className="text-sm">{notice}</p>}
              <p className="text-sm text-px-muted">{t("intro")}</p>
              {error && <p role="alert" className="text-sm text-px-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || stage === "checking"}>{loading ? t("submitting") : t("submit")}</Button>
            </form>
          )}
          {googleButton}
        </CardContent>
      </Card>
    </div>
  );
}
