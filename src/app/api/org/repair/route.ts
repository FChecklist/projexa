import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, organizations, veridianCredentials } from "@/lib/db";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { getVeridianApiKey, provisionVeridianOrg, VeridianApiError } from "@/lib/veridian-client";
import { withTiming } from "@/lib/with-timing";

// R48 UAT -- closes NO_VERIDIAN_CREDENTIALS_AR04, and the half of
// NO_CREDENTIAL_LIFECYCLE_SURFACE that says "no repair".
//
// THE HOLE THIS FILLS. /api/org/provision is create-once. Its idempotency
// guard (route.ts, the memberships lookup) returns early the moment the
// caller has ANY membership row, without ever asking whether that org
// actually has VERIDIAN credentials. So an org whose provisioning half-failed
// -- step 1 (VERIDIAN) and step 2 (org + membership) succeeded, step 3
// (veridian_credentials insert) did not -- is permanently stranded: every
// per-org call throws the AR-04 fail-loud error, and re-running provisioning
// can never fix it, because provisioning refuses by design for an org that
// already exists. That is not a hypothetical. The R48 demo tenant is in
// exactly this state: organization row present, 3 memberships present,
// veridian_credentials rows = 0, while every other org in the project has
// exactly 1.
//
// Any real customer whose signup died between step 2 and step 3 is in the
// same place, and today the only exit is a manual DB insert by someone with
// service-role access. That is why this is a product feature and not a
// one-off fixture script.
//
// SAP L5 PRECEDENT: a partially-created company code is completed by a
// dedicated repair/complete step (the config transaction is re-entered and
// the missing objects are generated); SAP does not require you to delete the
// entity and re-create it, because deletion would take the transactional
// history with it. Same shape here -- repair the org in place, never
// delete-and-recreate, because the org already owns memberships and
// (potentially) real work.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//   * It does not weaken the AR-04 guard in resolveApiKey(). A missing
//     credentials row must keep failing loudly. The fix is to supply the
//     row, never to fall back to the shared key -- that would be the
//     cross-tenant leak (E-45) AR-04 exists to prevent.
//   * It does not re-provision an org that already has credentials. Doing so
//     would strand the previous VERIDIAN org and rotate a working key out
//     from under a live tenant. Already-healthy is a 200 that changes nothing.
//   * It never returns the API key to the browser. Same rule as provision:
//     no VERIDIAN key, per-org or platform, may reach the client.

export const dynamic = "force-dynamic";

// GET -- diagnosis. Cheap, read-only, and safe to poll from a banner so the
// UI can tell "this workspace is not connected" from "this workspace is
// empty". Those two look identical today, which is a large part of why the
// broken state went unnoticed.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const forbidden = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (forbidden) return forbidden;

  const organizationId = ctx.organizationId!;
  const apiKey = await getVeridianApiKey(organizationId);

  return NextResponse.json({
    organizationId,
    // Boolean only -- presence, never the value.
    veridianConnected: apiKey !== null,
    repairAvailable: apiKey === null,
  });
});

export const POST = withTiming("POST", async function POST() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  // Provisioning credentials is a privileged act: it mints a VERIDIAN tenant
  // and binds this org to it. Owner/admin only, checked SERVER-SIDE at the
  // API boundary -- not in the UI. A route that authenticates but never
  // checks role is precisely the API_WRITE_WITHOUT_ROLE_CHECK defect this
  // run has open against 146 other routes; this one will not join them.
  const forbidden = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (forbidden) return forbidden;

  const organizationId = ctx.organizationId!;

  // Already healthy? Do nothing and say so. Never re-provision.
  const existingKey = await getVeridianApiKey(organizationId);
  if (existingKey) {
    return NextResponse.json({
      organizationId,
      repaired: false,
      alreadyHealthy: true,
      message: "This workspace is already connected to VERIDIAN. Nothing to repair.",
    });
  }

  // Read the org's own name/country so the repaired VERIDIAN tenant is
  // created with the same identity the customer signed up with, rather than
  // a placeholder. Read through the trusted server connection: the caller is
  // an owner/admin of this org and we have already proved it.
  let org: { name: string; country: string | null } | undefined;
  try {
    [org] = await db
      .select({ name: organizations.name, country: organizations.country })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
  } catch (err) {
    console.error("[org/repair] could not read organization", organizationId, ":", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not read your organisation. Please retry." }, { status: 503 });
  }

  if (!org) {
    // Membership pointed at an org that does not exist -- a different, worse
    // fault than the one this route repairs. Say so instead of papering over it.
    return NextResponse.json(
      { error: "Your membership points at an organisation that no longer exists. This needs support, not a repair." },
      { status: 409 }
    );
  }

  let veridianResult;
  try {
    veridianResult = await provisionVeridianOrg({
      customerOrgName: org.name,
      ...(org.country ? { country: org.country } : {}),
    });
  } catch (err) {
    console.error("[org/repair] VERIDIAN provisioning failed for org", organizationId, ":", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error:
          err instanceof VeridianApiError
            ? `Could not connect your VERIDIAN workspace: ${err.message}`
            : "Could not connect your VERIDIAN workspace. Please try again.",
      },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }

  // onConflictDoNothing guards the race where two admins repair at once:
  // organization_id is the primary key, so the second writer is a no-op
  // rather than an error or an overwrite. Whoever lost the race leaves one
  // orphaned VERIDIAN org -- the same acceptable tradeoff provision already
  // documents, and strictly better than clobbering a key another request
  // just wrote and may already be using.
  try {
    await db
      .insert(veridianCredentials)
      .values({
        organizationId,
        veridianOrgId: veridianResult.organisationId,
        veridianApiKey: veridianResult.apiKey,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error(
      "[org/repair] VERIDIAN org", veridianResult.organisationId,
      "was provisioned but storing veridian_credentials for", organizationId, "failed",
      "(is DATABASE_URL/SUPABASE_DB_PASSWORD configured?):", err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "We connected your workspace but couldn't save the connection. Please contact support." },
      { status: 500 }
    );
  }

  // Prove the repair actually took, by the same read path the rest of the
  // app uses -- not by assuming the insert worked. If this comes back null,
  // the repair did not happen and must not be reported as success.
  const verified = await getVeridianApiKey(organizationId);
  if (!verified) {
    console.error("[org/repair] post-write verification failed for org", organizationId, "-- credentials still not readable");
    return NextResponse.json(
      { error: "We connected your workspace but couldn't confirm it. Please contact support." },
      { status: 500 }
    );
  }

  return NextResponse.json({ organizationId, repaired: true }, { status: 201 });
});
