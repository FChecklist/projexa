import { sql } from "drizzle-orm";
import { db, veridianCredentials } from "@/lib/db";
import { getVeridianApiKey, provisionVeridianOrg, VeridianApiError } from "@/lib/veridian-client";

// The ONE implementation of "create this person's organisation", shared by POST /api/org/provision (the sign-up / login path) and by requireAuth()'s
// silent auto-provisioning of a signed-in person who has no membership (the e-mail-code sign-in creates the auth user and nothing else).
// Extracted from the route unchanged in behaviour; the ordering rule is kept: VERIDIAN side FIRST, then the PROJEXA rows, so a failure never leaves
// a PROJEXA org with no working backend.
//
// CONCURRENCY: two simultaneous page loads (or tabs, or a login + a page load) must create exactly ONE organisation.
//   1. in-process single-flight per user: a second caller in the same server instance shares the first caller's answer;
//   2. a Postgres advisory transaction lock per user, held for the whole create, so callers on DIFFERENT instances queue, and the second one then
//      finds the membership the first one wrote (the membership check below runs INSIDE the lock).
// The credentials insert goes through the SAME transaction handle: the db pool has one connection (db/index.ts max: 1), so a second db call while
// the lock transaction holds it would wait on itself forever.

export type SupabaseLike = { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ProvisionOutcome = { status: number; body: Record<string, unknown> };

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";
}

type InsertHandle = Pick<typeof db, "insert">;

async function underUserLock<T>(userId: string, run: (h: InsertHandle) => Promise<T>): Promise<T> {
  const d = db as unknown as {
    transaction?: (fn: (tx: InsertHandle & { execute: (q: unknown) => Promise<unknown> }) => Promise<T>) => Promise<T>;
  };
  if (typeof d.transaction !== "function") return run(db);
  return d.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"px-org-provision:" + userId}))`);
    return run(tx);
  });
}

async function provisionLocked(supabase: SupabaseLike, userId: string, orgName: string, h: InsertHandle): Promise<ProvisionOutcome> {
  // Idempotency guard: if this user already has an org (a duplicate call, or the client retried after a slow-but-successful response), don't create a second one.
  const { data: existingMembership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (existingMembership) {
    // R48 UAT: "has a membership" does not mean "is provisioned" -- report the real state and point at the repair path (POST /api/org/repair).
    const organizationId = existingMembership.organization_id as string;
    const veridianConnected = (await getVeridianApiKey(organizationId)) !== null;
    return {
      status: 200,
      body: {
        organizationId,
        alreadyProvisioned: true,
        veridianConnected,
        ...(veridianConnected ? {} : { repairRequired: true, repairPath: "/api/org/repair" }),
      },
    };
  }

  // Step 1: VERIDIAN first. If this fails nothing is created on the PROJEXA side.
  let veridianResult;
  try {
    veridianResult = await provisionVeridianOrg({ customerOrgName: orgName });
  } catch (err) {
    console.error("[org/provision] VERIDIAN provisioning failed:", err instanceof Error ? err.message : err);
    return {
      status: err instanceof VeridianApiError ? err.status : 502,
      body: {
        error:
          err instanceof VeridianApiError
            ? `Could not provision your PROJEXA workspace: ${err.message}`
            : "Could not provision your PROJEXA workspace. Please try again.",
      },
    };
  }

  // Step 2: PROJEXA's own organization + membership rows, using the caller's own session (same RLS policies sign-up always relied on).
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
    return { status: 500, body: { error: orgError?.message ?? "Failed to create organization" } };
  }

  const { error: membershipError } = await supabase
    .from("memberships")
    .insert({ user_id: userId, organization_id: org.id, role: "owner" });
  if (membershipError) {
    console.error(
      "[org/provision] VERIDIAN org", veridianResult.organisationId,
      "and PROJEXA org", org.id, "were created but the membership insert failed:", membershipError.message
    );
    return { status: 500, body: { error: membershipError.message } };
  }

  // Step 3: this org's VERIDIAN credentials, via the direct Postgres connection (public.veridian_credentials is service_role only).
  try {
    await h.insert(veridianCredentials).values({
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
    return {
      status: 500,
      body: { error: "Your account was created but we couldn't finish connecting it to your workspace. Please contact support." },
    };
  }

  return { status: 201, body: { organizationId: org.id } };
}

const inflight = new Map<string, Promise<ProvisionOutcome>>();

/** Creates (once) the organisation for `userId`. Safe to call concurrently for the same user: exactly one organisation results. */
export function provisionOrgForUser(supabase: SupabaseLike, userId: string, orgName: string): Promise<ProvisionOutcome> {
  const running = inflight.get(userId);
  if (running) return running;
  const p = underUserLock(userId, (h) => provisionLocked(supabase, userId, orgName, h)).finally(() => {
    inflight.delete(userId);
  });
  inflight.set(userId, p);
  return p;
}
