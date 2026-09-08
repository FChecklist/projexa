"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// G-08. Until this page existed, a PROJEXA user who forgot their password had
// no route back into the product at all. /login offers exactly one method --
// signInWithPassword (login/page.tsx) -- there is no magic-link, Google or SSO
// alternative on this app, and nothing anywhere calls resetPasswordForEmail.
// The recovery machinery was already built and simply had no entry point:
// /auth/callback has handled `type=recovery` since R47_AUTH_REDIRECT_01 and
// honours ?redirectTo, so the emailed link lands with a live session on
// /reset-password.
//
// WHY THE RESULT MESSAGE NEVER SAYS WHETHER THE ADDRESS EXISTS. A form that
// answers "no account with that email" is an account-enumeration oracle:
// anyone can test an address list against it and learn who your customers
// are. Supabase's resetPasswordForEmail does not distinguish either, and this
// page must not undo that by rendering its error differently from its success.
// So the same sentence is shown in both cases, and a genuine failure (network,
// rate limit) is surfaced only through the separate `error` state below, which
// never names the address.
export default function ForgotPasswordPage() {
  const t = useTranslations("Auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    // redirectTo goes through /auth/callback rather than straight to
    // /reset-password: the callback is what exchanges the recovery credential
    // for a session (implicit fragment, ?code, or ?token_hash -- see its own
    // header), and /reset-password is a protected page that needs that session
    // to already exist when it renders.
    const redirectTo = `${window.location.origin}/auth/callback?redirectTo=/reset-password`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    // A rate-limit or transport failure is a real failure and is shown as one.
    // "That address has no account" is NOT reported -- see the header.
    if (resetError && resetError.status !== 400 && resetError.status !== 422) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-px-concrete p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div role="status" className="space-y-4">
              <p className="text-sm text-px-muted">{t("sentBody")}</p>
              <a href="/login" className="block text-center text-sm font-semibold text-px-ink underline">
                {t("backToLogin")}
              </a>
            </div>
          ) : (
            <>
              <p className="mb-4 text-sm text-px-muted">{t("intro")}</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
              <p className="mt-4 text-center text-sm text-px-muted">
                <a href="/login" className="font-semibold text-px-ink underline">
                  {t("backToLogin")}
                </a>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
