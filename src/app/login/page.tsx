"use client";

// P1: the one door. E-mail -> 6-digit code by e-mail -> in. No password anywhere (see src/lib/auth/email-code-login.ts for the rules).
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createIdentityStore, getDurableIdentity, mirrorSession } from "@/lib/local-first/identity";
import { openDeviceMeta } from "@/lib/local-first/device-meta";
import { ensureServiceWorker } from "@/lib/local-first/release/sw-client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { viaPxApi } from "@/lib/px-api";
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
  const submitting = useRef(false);

  const login = useMemo(() => {
    const supabase = createClient();
    const identityStore = () => createIdentityStore({ storage: window.localStorage, openMeta: () => openDeviceMeta() });
    const deps: LoginDeps = {
      auth: supabase.auth as unknown as AuthLike,
      storage: window.localStorage,
      now: Date.now,
      isOnline: () => navigator.onLine !== false,
      // Only the public app shell (the service worker). The organisation's data is copied after sign-in by WorkspacePrepare, never before.
      startShellInstall: () => ensureServiceWorker(),
      hasSavedIdentity: async () => Boolean(await getDurableIdentity(identityStore())),
      afterVerified: async () => {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) return { ok: false, notice: t("genericError") };
        // Finish provisioning when a company name was kept from the old sign-up (otherwise a brand-new e-mail simply opens an empty workspace;
        // invitations attach an organisation through the existing invite flow).
        const { data: existing } = await supabase.from("memberships").select("organization_id").eq("user_id", session.user.id).limit(1).maybeSingle();
        if (!existing) {
          const pendingOrgName = window.localStorage.getItem("projexa_pending_org_name");
          if (pendingOrgName) {
            const res = await viaPxApi("/api/org/provision", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orgName: pendingOrgName }),
            });
            if (res.ok) window.localStorage.removeItem("projexa_pending_org_name");
            else {
              const body = await res.json().catch(() => ({ error: t("provisionError") }));
              return { ok: false, notice: body.error ?? t("provisionError") };
            }
          }
        }
        // Keep this person's identity on the laptop so it reopens offline with no code (best effort, never blocks).
        try { await mirrorSession(identityStore(), session as never); } catch { /* the identity mirror also does this */ }
        return { ok: true };
      },
    };
    return createEmailCodeLogin(deps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goIn() {
    // AUDIT-100 B6/B56: back to where the person came from (an invitation link, a signed-in page), same-origin paths only.
    router.push(safeRedirectPath(new URLSearchParams(window.location.search).get("redirectTo")));
    router.refresh();
  }

  useEffect(() => {
    let alive = true;
    void login.start().then((s) => {
      if (!alive) return;
      if (s === "session") goIn();
      else setStage(s === "form" ? "email" : "offline");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login]);

  useEffect(() => {
    if (stage !== "code") return;
    const id = setInterval(() => setResendIn(login.resendInMs()), 1000);
    return () => clearInterval(id);
  }, [stage, login]);

  async function sendCode(e?: React.FormEvent, resend = false) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    const r = await login.requestCode(email, { resend });
    setLoading(false);
    if (!r.ok) { setError(r.notice); return; }
    setCode("");
    setResendIn(login.resendInMs());
    setStage("code");
  }

  async function checkCode(value: string) {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setLoading(true);
    const r = await login.submitCode(email, value);
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
              <p className="text-sm text-px-muted">{t("intro")}</p>
              {error && <p role="alert" className="text-sm text-px-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || stage === "checking"}>{loading ? t("submitting") : t("submit")}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
