"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// G-08, second half. The recovery link from /forgot-password lands on
// /auth/callback, which turns the emailed credential into a real session and
// then forwards here. So by the time this renders the visitor IS signed in --
// on a recovery session, which Supabase grants exactly one privilege that
// matters: it may call updateUser({ password }).
//
// THIS PAGE IS PUBLIC in page-access.ts, and the session check below is what
// makes that safe. Gating it would be harmless in the normal case -- the
// recovery link mints a session before forwarding here -- but the case that
// matters is the link that has EXPIRED or been used already, and there a
// redirect to /login tells the visitor nothing about what went wrong. The
// check below says "this link has expired, request another", which is the
// answer they actually need. Nothing on this page can be done without a
// session: updateUser() has no effect without one.
//
// MINIMUM LENGTH is asserted here as well as by Supabase. The server is the
// authority (its own minimum rejects short passwords with a 422), but a form
// that only learns this after a round trip reads as a broken form.
const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const t = useTranslations("Auth.resetPassword");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedSession, setCheckedSession] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  // A recovery link is single-use and short-lived, so arriving here proves
  // nothing about whether a session exists RIGHT NOW. Asking Supabase directly
  // is what distinguishes "your link expired -- request another" from a submit
  // that fails for no visible reason.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient().auth.getSession();
      if (cancelled) return;
      setHasSession(Boolean(data.session));
      setCheckedSession(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }

    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Straight to the product, not back to /login: the recovery session is a
    // real session, so bouncing to a login form would make the user type the
    // password they just set, one second after setting it.
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
          {checkedSession && !hasSession ? (
            <div role="alert" className="space-y-4">
              <p className="text-sm text-px-muted">{t("linkExpired")}</p>
              <a
                href="/forgot-password"
                className="block text-center text-sm font-semibold text-px-ink underline"
              >
                {t("requestAnother")}
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("newPassword")}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">{t("confirmPassword")}</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-px-error">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("submitting") : t("submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
