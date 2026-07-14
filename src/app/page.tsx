import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClaimsWithRetry } from "@/lib/supabase/get-claims-with-retry";
import { LandingPage } from "@/components/marketing/LandingPage";

// The root route used to unconditionally redirect() to /dashboard regardless
// of auth state, so a logged-out visitor bounced straight to /login (via
// middleware's protected-route check) without ever seeing what PROJEXA is.
// This is PROJEXA's first marketing page: logged-out visitors see it,
// logged-in visitors are sent straight to /dashboard (mirroring the same
// pattern middleware.ts already uses for /login and /signup) rather than
// being forced through marketing copy on every visit.
export default async function RootPage() {
  const supabase = await createClient();
  const { data, error } = await getClaimsWithRetry(supabase);
  if (error) {
    console.error("[/] getClaims() failed -- treating as logged out:", error.message);
  }
  const userId = (data?.claims?.sub as string | undefined) ?? null;

  if (userId) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}
