"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// R47_AUTH_REDIRECT_01 (found 2026-08-25): PROJEXA had NO auth callback route
// of any kind. Every emailed Supabase auth link -- signup email confirmation,
// magic link, and password reset -- delivers its credential either as a URL
// FRAGMENT (implicit flow: #access_token=...&refresh_token=...) or as a query
// param (?code= for PKCE, ?token_hash=&type= for the newer verify flow). A
// fragment is never sent to the server, and nothing on the client was
// instantiating a Supabase browser client on page load, so the credential was
// simply dropped on the floor: the recipient landed on /login, still logged
// out, with no error and no explanation.
//
// Consequence before this route existed: a real user could not confirm an
// email address or complete a password reset AT ALL. That was invisible to the
// entire test estate because every automated session since R33 authenticates
// by minting a token directly and has never once followed an emailed link --
// the exact shape of M16 ("a health check that cannot fail is not a health
// check"), applied to a whole capability nobody exercised.
//
// This route is deliberately CLIENT-side. createBrowserClient() writes the
// session through @supabase/ssr's own cookie encoder (base64url + 3180-byte
// chunking), which is the only thing that produces cookies the middleware's
// getClaims() can read back. Hand-writing those cookies is what produces the
// "[middleware] getClaims() threw: Expected ',' or '}' after property value in
// JSON" error group -- a malformed chunked cookie. Never construct them by hand.
// forgot-password/page.tsx stores the address here when it sends the reset email, so the link can tell whether this is the
// machine that asked for it. localStorage only ever holds an email address, never a credential.
function isRequestingMachine(): boolean {
  try {
    return Boolean(window.localStorage.getItem("projexa_recovery_email"));
  } catch {
    return false;
  }
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // A password-reset link opened on a machine that did NOT request it: sign-in is not automatic there; the person confirms
  // with their email and the 6-digit code from the same email instead (code and link are the same one-time credential).
  const [needsCode, setNeedsCode] = useState(false);
  const [codeEmail, setCodeEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      // A fragment arrives as "#access_token=...&refresh_token=..."; parse it
      // the same way a query string is parsed, minus the leading "#".
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

      // Supabase reports link failures (expired/already-used) in the fragment
      // too. Surface that verbatim rather than silently bouncing to /login,
      // which is indistinguishable from "your password was wrong".
      const linkError = hash.get("error_description") ?? url.searchParams.get("error_description");
      if (linkError) {
        if (!cancelled) setError(linkError);
        return;
      }

      try {
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (accessToken && refreshToken) {
          // Implicit flow. setSession() is explicit rather than relying on
          // detectSessionInUrl firing as a side effect of construction, so the
          // redirect below cannot race the cookie write.
          const { error: e } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (e) throw e;
        } else if (code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(code);
          if (e) throw e;
        } else if (tokenHash && type === "recovery" && !isRequestingMachine()) {
          if (!cancelled) setNeedsCode(true);
          return;
        } else if (tokenHash && type) {
          const { error: e } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as "magiclink" | "signup" | "recovery" | "invite" | "email_change" | "email",
          });
          if (e) throw e;
        } else {
          if (!cancelled) setError("This sign-in link is missing its credential. Request a new one.");
          return;
        }

        // Confirm the session is actually readable before navigating. A
        // redirect fired before the cookie is durable lands the user back on
        // /login, which reads to them as "it didn't work".
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          if (!cancelled) setError("Signed in, but the session did not persist. Check that cookies are enabled.");
          return;
        }

        // R48_SIGNUP_UNCOMPLETABLE_01: signup defers org creation whenever
        // email confirmation is required -- it stashes the name and expects a
        // later authenticated page to finish the job (see signup/page.tsx).
        // login/page.tsx already did that, but the confirmation link does NOT
        // go through /login, it lands HERE. Without this block a user who
        // confirms by email arrives at /dashboard authenticated but with no
        // organization at all, and every API route answers "No organization"
        // (400) -- a signed-in account that cannot use the product. Provision
        // before navigating, and surface a failure instead of dropping them
        // into a dashboard that cannot work.
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
            const body = await res.json().catch(() => ({}));
            if (!cancelled) {
              setError(
                (body as { error?: string }).error ??
                  "Your email is confirmed, but we could not finish setting up your organisation. Sign in to retry."
              );
            }
            return;
          }
        }

        if (cancelled) return;
        const target = url.searchParams.get("redirectTo") ?? url.searchParams.get("next") ?? "/dashboard";
        // Only ever navigate to a same-origin path, so a crafted link cannot
        // turn this route into an open redirect.
        router.replace(target.startsWith("/") && !target.startsWith("//") ? target : "/dashboard");
        router.refresh();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not complete sign-in.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCodeBusy(true);
    const { error: otpError } = await createClient().auth.verifyOtp({ email: codeEmail.trim(), token: code.trim(), type: "recovery" });
    if (otpError) {
      setError(otpError.message);
      setCodeBusy(false);
      return;
    }
    router.replace("/reset-password");
    router.refresh();
  }

  if (needsCode) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <form onSubmit={submitCode} className="w-full max-w-sm space-y-4">
          <h1 className="text-lg font-semibold">Confirm it is you</h1>
          <p className="text-sm text-muted-foreground">Enter your email and the 6-digit code from the reset email.</p>
          <input className="w-full rounded border px-3 py-2" type="email" required autoComplete="email" placeholder="Email" value={codeEmail} onChange={(e) => setCodeEmail(e.target.value)} />
          <input className="w-full rounded border px-3 py-2" inputMode="numeric" pattern="[0-9]{6,10}" required placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-60" type="submit" disabled={codeBusy}>
            {codeBusy ? "Checking…" : "Continue"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {error ? (
        <div role="alert" className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold">Sign-in link could not be used</h1>
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <a className="text-sm underline" href="/login">
            Back to sign in
          </a>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      )}
    </main>
  );
}
