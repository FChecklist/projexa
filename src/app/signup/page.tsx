"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function SignupPage() {
  const router = useRouter();
  const t = useTranslations("Auth.signup");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    // R48_SIGNUP_UNCOMPLETABLE_01: the emailed confirmation link must come
    // back to /auth/callback, which is the only route that consumes a
    // credential and finishes provisioning (see auth/callback/page.tsx).
    // Without emailRedirectTo the link falls back to the project's Site URL
    // and the recipient lands somewhere that drops the credential silently.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      // Email confirmation is required before a session exists -- stash the
      // org name so login/page.tsx can finish provisioning on first login.
      window.localStorage.setItem("projexa_pending_org_name", orgName);
      setNeedsEmailConfirm(true);
      setLoading(false);
      return;
    }

    // Organization creation (PROJEXA org + membership + VERIDIAN
    // provisioning) happens entirely server-side now -- see
    // /api/org/provision. The VERIDIAN platform application key that
    // endpoint uses must never reach the browser, and provisioning a real
    // VERIDIAN tenant is not something the client should be able to trigger
    // or retry arbitrarily.
    const res = await fetch("/api/org/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: t("genericError") }));
      setError(body.error ?? t("genericError"));
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (needsEmailConfirm) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-px-concrete p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="font-heading text-xl">{t("checkEmailTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-px-muted">{t("checkEmailBody", { email })}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-px-concrete p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="orgName">{t("companyName")}</Label>
              <Input id="orgName" required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={t("companyNamePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-px-error">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? t("submitting") : t("submit")}</Button>
          </form>
          <p className="mt-4 text-center text-sm text-px-muted">
            {t("haveAccount")} <a href="/login" className="font-semibold text-px-ink underline">{t("loginLink")}</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
