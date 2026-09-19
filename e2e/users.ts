// Real seeded PROJEXA login accounts for "Meridian Construction Group (E2E
// Test Org)", per PHASE1_SEED_REPORT.md section (c) and
// scripts/phase1-provision-projexa-accounts.mjs. Password is shared across
// all 11 accounts by design (documented in the same report) -- not a
// leaked secret, this is the intentional E2E test-org credential, same
// precedent as PHASE1_SEED_REPORT.md itself committing it in plaintext.
//
// IMPORTANT, confirmed empirically (see PHASE2_BATCH_C_FINDINGS.md): PROJEXA's
// own local `memberships.role` ("owner" | "admin" | "pm" | "site_engineer" |
// "member" | "client_viewer") -- NOT the seeded employee_profiles.job_title --
// gates admin-only UI (isHrAdmin in src/hooks/use-org-role.ts). This was
// originally seeded with ONLY Arjun Mehta (the CEO) at "owner" and all other
// 10 accounts at "member", regardless of real-world job title -- a real,
// verified gap (see findings doc). THREE of those 10 have since been
// deliberately promoted, each for a specific, real testing need (not
// restored to "member" afterward -- each promotion is still load-bearing for
// its own spec, see the inline note on each account below):
//   - Deepak Joshi: member -> pm (BOQ actor-attribution/self-approval fix,
//     Playwright gap-closure Round 1, 2026-09-19)
//   - Manoj Yadav: member -> site_engineer (matches his own "Site Supervisor"
//     fixture name -- promoted for the Merge 6 workspace role-visibility
//     tests, 2026-09-19, since no seeded account had this role before)
//   - Karan Malhotra: member -> client_viewer (same reason -- no seeded
//     account had this role before; Karan had no existing auth.setup.ts
//     fixture, so repurposing him was zero-risk)
// The remaining 7 (Aditya, Ananya, Kavita, Priya, Rohan, Sneha, Vikram) are
// still genuinely "member" -- Sneha (the "hr" fixture below) is the one
// e2e/auth.setup.ts logs in, so she is this suite's own real "member" role
// fixture wherever a plain member (as opposed to pm/site_engineer/
// client_viewer) is what a spec needs.
export const PASSWORD = process.env.E2E_PASSWORD ?? "MeridianE2E2026!";

export const USERS = {
  ceo: {
    email: "arjun.mehta@meridian-construction.e2e-test.projexa-ai.com",
    password: PASSWORD,
    name: "Arjun Mehta",
    localRole: "owner" as const, // the only account with isHrAdmin === true
  },
  finance: {
    email: "deepak.joshi@meridian-construction.e2e-test.projexa-ai.com",
    password: PASSWORD,
    name: "Deepak Joshi",
    localRole: "pm" as const, // promoted 2026-09-19, see the file header note
  },
  hr: {
    email: "sneha.reddy@meridian-construction.e2e-test.projexa-ai.com",
    password: PASSWORD,
    name: "Sneha Reddy",
    localRole: "member" as const,
  },
  // Added for Batch B's non-admin access check (see PHASE2_BATCH_B_FINDINGS.md)
  // -- Site Supervisor, originally seeded at plain "member" (taken literally
  // against that task's "a member account otherwise" instruction), promoted
  // to the real "site_engineer" role 2026-09-19 (see the file header note) --
  // this is now the suite's own real FIELD-role fixture, not a "member"
  // wearing a Site Supervisor job title.
  siteSupervisor: {
    email: "manoj.yadav@meridian-construction.e2e-test.projexa-ai.com",
    password: PASSWORD,
    name: "Manoj Yadav",
    localRole: "site_engineer" as const,
  },
  // Added 2026-09-19 for the Merge 6 workspace role-visibility tests -- the
  // suite's first genuine client_viewer fixture. Karan had no prior
  // auth.setup.ts entry, so promoting him from "member" was zero-risk.
  clientViewer: {
    email: "karan.malhotra@meridian-construction.e2e-test.projexa-ai.com",
    password: PASSWORD,
    name: "Karan Malhotra",
    localRole: "client_viewer" as const,
  },
} as const;

export type UserKey = keyof typeof USERS;
