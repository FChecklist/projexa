import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClaimsWithRetry } from "@/lib/supabase/get-claims-with-retry";
import { withTiming } from "@/lib/with-timing";
import { sendInviteWelcome, type WelcomeSupabase } from "@/lib/email/invite-welcome";

/** AUDIT-100 B55: the most the welcome e-mail may add to an accept. It is sent before the answer (a serverless function may be frozen the
 *  moment it answers), but it never decides the answer and never holds it longer than this. */
const WELCOME_BUDGET_MS = 15_000;

// Redemption. Deliberately NOT behind requireAuth(): requireAuth() answers
// 400 "No organization" for exactly the user this route exists to serve --
// somebody authenticated who is not yet a member of anything. It verifies the
// session itself and delegates every authorisation decision to
// public.accept_org_invite(), which checks revocation, expiry, reuse and the
// email binding in one place (drizzle/0015_org_invites.sql).
//
// AUDIT-100 B55: ONLY after the function has attached the person (a used, wrong, revoked or expired token never gets here), they are sent
// one "Welcome to <org>" e-mail carrying their own AI prompt (src/lib/email/invite-welcome.ts). Fail-soft: whatever happens to the e-mail,
// the answer is the same.
export const POST = withTiming("POST", async function POST(req: Request) {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await getClaimsWithRetry(supabase);
  if (claimsError || !claims?.claims) {
    return NextResponse.json({ error: "You must be signed in to accept an invitation." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token?.trim();
  if (!token) return NextResponse.json({ error: "An invitation token is required." }, { status: 400 });

  const { data, error } = await supabase.rpc("accept_org_invite", { p_token: token });
  if (error) {
    // The function raises a human-readable message for every reachable
    // rejection; surface it verbatim rather than a generic failure (C19
    // ERROR_TRUTHFUL).
    const status = error.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  const organizationId = typeof data === "string" ? data : String(data ?? "");
  const email = typeof claims.claims.email === "string" ? claims.claims.email : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    sendInviteWelcome(supabase as unknown as WelcomeSupabase, { email }, organizationId).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(resolve, WELCOME_BUDGET_MS); }),
  ]);
  clearTimeout(timer);

  return NextResponse.json({ organizationId: data });
});
