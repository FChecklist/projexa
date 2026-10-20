import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClaimsWithRetry } from "@/lib/supabase/get-claims-with-retry";
import { provisionOrgForUser } from "@/lib/org/provision-org";
import { withTiming } from "@/lib/with-timing";

// Priority 17 (VERIDIAN platform provisioning): the ONLY place PROJEXA
// creates a new organization row. Called from signup/page.tsx right after
// supabase.auth.signUp() resolves with a session, and from login/page.tsx
// to finish provisioning when signup had to defer for email confirmation
// (see both files' "pending org" comments). Server-side only -- this is
// where provisionVeridianOrg() runs, and the VERIDIAN_PLATFORM_APPLICATION_KEY
// it uses must never reach the browser.
//
// Ordering is deliberate: VERIDIAN provisioning happens FIRST, before any
// PROJEXA-side row is written. If it fails, nothing is created on the
// PROJEXA side at all -- the caller (an authenticated user with no org yet,
// same recoverable state signup already handles for the email-confirm case)
// can just retry this endpoint later. This avoids ever having a PROJEXA org
// that exists but has no working VERIDIAN backend -- the one thing the task
// explicitly said not to silently allow. The tradeoff, noted honestly: a
// retry after a failure on step 2/3 below (after VERIDIAN already
// succeeded) can leave one orphaned-but-harmless VERIDIAN org with nothing
// pointing at it -- acceptable, since it holds no PROJEXA customer data and
// isn't reachable without the row we failed to write.
export const POST = withTiming("POST", async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { orgName?: string } | null;
  const orgName = body?.orgName?.trim();
  if (!orgName) {
    return NextResponse.json({ error: "orgName is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await getClaimsWithRetry(supabase);
  if (error || !data?.claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = data.claims.sub as string;

  // The create itself (idempotency guard, VERIDIAN-first ordering, per-user lock) lives in src/lib/org/provision-org.ts, shared with requireAuth().
  try {
    const out = await provisionOrgForUser(supabase as never, userId, orgName);
    return NextResponse.json(out.body, { status: out.status });
  } catch (err) {
    console.error("[org/provision] provisioning threw:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not provision your PROJEXA workspace. Please try again." }, { status: 503 });
  }
});
