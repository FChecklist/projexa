import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClaimsWithRetry } from "@/lib/supabase/get-claims-with-retry";
import { db, organizations, memberships, veridianCredentials } from "@/lib/db";
import { provisionVeridianOrg, VeridianApiError } from "@/lib/veridian-client";

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
function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";
}

export async function POST(req: Request) {
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

  // Idempotency guard: if this user already has an org (e.g. a duplicate
  // provisioning call, or the client retried after a slow-but-successful
  // response), don't create a second one.
  const { data: existingMembership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (existingMembership) {
    return NextResponse.json({ organizationId: existingMembership.organization_id, alreadyProvisioned: true });
  }

  // Step 1: provision the VERIDIAN side first. If this fails, fail the
  // signup outright with a clear error -- do not create a PROJEXA org that
  // has no working backend.
  let veridianResult;
  try {
    veridianResult = await provisionVeridianOrg({ customerOrgName: orgName });
  } catch (err) {
    console.error("[org/provision] VERIDIAN provisioning failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error:
          err instanceof VeridianApiError
            ? `Could not provision your VERIDIAN workspace: ${err.message}`
            : "Could not provision your VERIDIAN workspace. Please try again.",
      },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }

  // Step 2: create PROJEXA's own organization + membership rows, using the
  // caller's own session (same RLS policies signup used to rely on
  // client-side -- see drizzle/0003_signup_insert_policies.sql).
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: orgName, slug: `${slugify(orgName)}-${Math.random().toString(36).slice(2, 7)}` })
    .select()
    .single();
  if (orgError || !org) {
    console.error(
      "[org/provision] VERIDIAN org", veridianResult.organisationId,
      "was provisioned but creating the PROJEXA organization row failed:", orgError?.message
    );
    return NextResponse.json({ error: orgError?.message ?? "Failed to create organization" }, { status: 500 });
  }

  const { error: membershipError } = await supabase
    .from("memberships")
    .insert({ user_id: userId, organization_id: org.id, role: "owner" });
  if (membershipError) {
    console.error(
      "[org/provision] VERIDIAN org", veridianResult.organisationId,
      "and PROJEXA org", org.id, "were created but the membership insert failed:", membershipError.message
    );
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  // Step 3: store this org's VERIDIAN credentials. Written via Drizzle's
  // direct Postgres connection (db), not the RLS-governed Supabase client --
  // public.veridian_credentials is locked to service_role only (see
  // schema.ts comment), and this is trusted server code.
  try {
    await db.insert(veridianCredentials).values({
      organizationId: org.id,
      veridianOrgId: veridianResult.organisationId,
      veridianApiKey: veridianResult.apiKey,
    });
  } catch (err) {
    console.error(
      "[org/provision] VERIDIAN org", veridianResult.organisationId,
      "and PROJEXA org", org.id, "were created but storing veridian_credentials failed",
      "(is DATABASE_URL/SUPABASE_DB_PASSWORD configured?):", err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Your account was created but we couldn't finish connecting it to your workspace. Please contact support." },
      { status: 500 }
    );
  }

  return NextResponse.json({ organizationId: org.id }, { status: 201 });
}
