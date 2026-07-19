// PROJEXA E2E Testing Program -- Phase 1 -- step 5 (account provisioning).
//
// NOT YET EXECUTED. This script is ready to run but was blocked in the Phase 1
// session by a genuine credential-access gap: SUPABASE_SERVICE_ROLE_KEY /
// SUPABASE_DB_PASSWORD for PROJEXA's own Supabase project (evpckeuxgvahguwsaeul)
// are configured as Vercel "Sensitive" environment variables, which `vercel env
// pull` deliberately cannot retrieve (by Vercel's own design -- confirmed live,
// not a guess: the pulled file contains the literal string "[SENSITIVE]" for
// every such var). No Supabase MCP tool was available in this session either.
// See PHASE1_SEED_REPORT.md section (e) for the full account-provisioning writeup.
//
// To run this once you have a real SUPABASE_SERVICE_ROLE_KEY for
// evpckeuxgvahguwsaeul (Settings > API in the Supabase dashboard, or via a
// session with Supabase MCP access):
//
//   NEXT_PUBLIC_SUPABASE_URL=https://evpckeuxgvahguwsaeul.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<real key> \
//   DATABASE_URL=<PROJEXA's own postgres connection string, for the organizations/
//     memberships/veridian_credentials inserts -- same project, direct Postgres> \
//   node scripts/phase1-provision-projexa-accounts.mjs
//
// This creates: 1 new PROJEXA organizations row ("Meridian Construction Group
// (E2E Test Org)"), 11 real Supabase Auth users (email_confirm: true, so no
// email-confirmation step is needed), 11 memberships rows (all in the SAME new
// PROJEXA org -- PROJEXA has no self-serve team-invite flow, see
// src/app/api/org-members/route.ts being GET-only, so this direct-insert path
// mirrors the exact precedent used for the original 3 democeo@projexa-ai.com
// accounts: 1 via real signup, 2 via direct auth.users/auth.identities inserts +
// a manual memberships row -- see claude-control/CONTROLLER.yaml PROJEXA-DEMO-01),
// and 1 veridian_credentials row pointing at the REAL compliance-tracker org +
// vk_ apiKey already minted during Phase 1 (see below -- do not re-mint, reuse
// these exact values so this bridges to the already-seeded business data).
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -- see header comment.");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Real values, already created live during Phase 1 (compliance-tracker DB,
// 2026-07-19) -- do NOT regenerate, reuse exactly as-is so this bridges to the
// already-seeded 4-project construction dataset.
const VERIDIAN_ORG_ID = "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d"; // compliance.organisations.id ("Meridian Construction Group (E2E Test Org)")
const VERIDIAN_API_KEY = "vk_GJrYOpZukkCSplVNYI3IEF6LxwvOWDU0"; // compliance.api_keys row b199026b-dc76-402e-ab40-616db6068774, scopes read+write

const ORG_NAME = "Meridian Construction Group (E2E Test Org)";
const EMAIL_DOMAIN = "meridian-construction.e2e-test.projexa-ai.com";
const PASSWORD = "MeridianE2E2026!"; // rotate after Phase 2/3 testing completes

// role: PROJEXA's own local memberships.role (text, "owner" | "member" --
// see src/app/api/org/provision/route.ts's `role: "owner"` for the creator).
// This is separate from compliance.users.role (the construction-business role
// seeded in compliance-tracker) -- PROJEXA itself only has a 2-value concept.
const people = [
  { first: "Arjun", last: "Mehta", role: "owner" }, // CEO
  { first: "Rohan", last: "Kapoor", role: "member" }, // Project Manager
  { first: "Vikram", last: "Singh", role: "member" }, // Site Engineer
  { first: "Manoj", last: "Yadav", role: "member" }, // Site Supervisor
  { first: "Priya", last: "Nair", role: "member" }, // Quantity Surveyor
  { first: "Ananya", last: "Rao", role: "member" }, // Procurement Manager
  { first: "Karan", last: "Malhotra", role: "member" }, // Safety Officer
  { first: "Sneha", last: "Reddy", role: "member" }, // HR Administrator
  { first: "Deepak", last: "Joshi", role: "member" }, // Finance & Accounts Manager
  { first: "Kavita", last: "Iyer", role: "member" }, // Design Lead
  { first: "Aditya", last: "Verma", role: "member" }, // Document Controller
];

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";
}

async function main() {
  const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();

  // 1. PROJEXA organizations row (mirrors POST /api/org/provision's step 2,
  // minus the VERIDIAN provisioning call -- that already happened, we're
  // wiring to the org created in Phase 1).
  const orgRes = await pgClient.query(
    `insert into organizations (name, slug, country) values ($1, $2, $3) returning id`,
    [ORG_NAME, `${slugify(ORG_NAME)}-${Math.random().toString(36).slice(2, 7)}`, "IN"]
  );
  const projexaOrgId = orgRes.rows[0].id;
  console.log("PROJEXA organizations.id:", projexaOrgId);

  // 2. veridian_credentials bridge row (service_role-only table).
  await pgClient.query(
    `insert into veridian_credentials (organization_id, veridian_org_id, veridian_api_key) values ($1, $2, $3)`,
    [projexaOrgId, VERIDIAN_ORG_ID, VERIDIAN_API_KEY]
  );
  console.log("veridian_credentials row created, bridging to compliance-tracker org", VERIDIAN_ORG_ID);

  // 3. 11 real Supabase Auth users + memberships rows, all in the SAME org.
  const created = [];
  for (const p of people) {
    const email = `${p.first.toLowerCase()}.${p.last.toLowerCase()}@${EMAIL_DOMAIN}`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
    });
    if (error) {
      console.error(`FAILED to create auth user ${email}:`, error.message);
      continue;
    }
    // profiles row is auto-created by the on_auth_user_created trigger (see
    // drizzle/0004 -- profiles is populated from auth.users, never written
    // to directly by app code).
    await pgClient.query(
      `insert into memberships (user_id, organization_id, role) values ($1, $2, $3)`,
      [data.user.id, projexaOrgId, p.role]
    );
    created.push({ ...p, email, authUserId: data.user.id });
    console.log(`created ${email} (${p.role}) -> auth_user_id ${data.user.id}`);
  }

  await pgClient.end();

  console.log("\n=== Summary ===");
  console.log("PROJEXA org id:", projexaOrgId);
  console.log(`Created ${created.length}/${people.length} accounts. Password (all): ${PASSWORD}`);
  console.log(JSON.stringify(created, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
