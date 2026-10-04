"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createIdentityStore } from "@/lib/local-first/identity";
import { openDeviceMeta } from "@/lib/local-first/device-meta";
import { rememberPinAfterOnlineLogin, unlockOffline } from "@/lib/local-first/offline-pin";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("Auth.login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // Offline: open this laptop's own copy with the passcode kept from the last online sign-in (offline-pin.ts). Online is unchanged.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const identityStore = createIdentityStore({ storage: window.localStorage, openMeta: () => openDeviceMeta() });
      const result = await unlockOffline({ storage: window.localStorage, identityStore }, email, password);
      if (!result.ok) {
        setError(result.notice);
        setLoading(false);
        return;
      }
      window.location.assign("/dashboard");
      return;
    }

    const supabase = createClient();

    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError || !data.session) {
      setError(loginError?.message ?? t("genericError"));
      setLoading(false);
      return;
    }

    // Finish provisioning if signup deferred org creation for email
    // confirmation (see signup/page.tsx). Provisioning itself (PROJEXA org +
    // membership + VERIDIAN tenant) runs entirely server-side via
    // /api/org/provision -- see that route's comment for why.
    const { data: existing } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", data.session.user.id)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const pendingOrgName = window.localStorage.getItem("projexa_pending_org_name");
      if (pendingOrgName) {
        const res = await fetch("/api/org/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgName: pendingOrgName }),
        });
        if (res.ok) {
          window.localStorage.removeItem("projexa_pending_org_name");
        } else {
          const body = await res.json().catch(() => ({ error: t("provisionError") }));
          setError(body.error ?? t("provisionError"));
          setLoading(false);
          return;
        }
      }
    }

    // Keep a salted hash of the passcode on this laptop so it can sign back in offline (best effort, never blocks).
    const meta = data.session.user.user_metadata as Record<string, unknown> | null;
    await rememberPinAfterOnlineLogin(window.localStorage, email, password, { userId: data.session.user.id, name: typeof meta?.name === "string" ? meta.name : null });

    router.push("/dashboard");
    router.refresh();
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
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-px-error">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? t("submitting") : t("submit")}</Button>
          </form>
          {/* G-08: signInWithPassword above is the ONLY way into this app --
              no magic link, no Google, no SSO -- so before this link existed a
              forgotten password was a permanent lockout with no route back. */}
          <p className="mt-3 text-center text-sm">
            <a href="/forgot-password" className="text-px-muted underline">{t("forgotPasswordLink")}</a>
          </p>
          <p className="mt-4 text-center text-sm text-px-muted">
            {t("noAccount")} <a href="/signup" className="font-semibold text-px-ink underline">{t("signUpLink")}</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
