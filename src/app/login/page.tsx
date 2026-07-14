"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError || !data.session) {
      setError(loginError?.message ?? "Login failed");
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
          const body = await res.json().catch(() => ({ error: "Failed to finish setting up your workspace" }));
          setError(body.error ?? "Failed to finish setting up your workspace");
          setLoading(false);
          return;
        }
      }
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-px-concrete p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Log in to PROJEXA</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-px-error">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Logging in…" : "Log in"}</Button>
          </form>
          <p className="mt-4 text-center text-sm text-px-muted">
            No account? <a href="/signup" className="font-semibold text-px-ink underline">Sign up</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
