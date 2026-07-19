// Real seeded PROJEXA login accounts for "Meridian Construction Group (E2E
// Test Org)", per PHASE1_SEED_REPORT.md section (c) and
// scripts/phase1-provision-projexa-accounts.mjs. Password is shared across
// all 11 accounts by design (documented in the same report) -- not a
// leaked secret, this is the intentional E2E test-org credential, same
// precedent as PHASE1_SEED_REPORT.md itself committing it in plaintext.
//
// IMPORTANT, confirmed empirically (see PHASE2_BATCH_C_FINDINGS.md): PROJEXA's
// own local `memberships.role` ("owner" | "admin" | "member") -- NOT the
// seeded employee_profiles.job_title -- gates admin-only UI (isHrAdmin in
// src/hooks/use-org-role.ts). scripts/phase1-provision-projexa-accounts.mjs
// gives ONLY Arjun Mehta (the CEO) `role: "owner"`; all other 10 accounts,
// including Sneha Reddy (HR Administrator by job title) and Deepak Joshi
// (Finance & Accounts Manager by job title), get PROJEXA's local "member"
// role. So admin-gated actions (New Employee Profile, New Department,
// Approve Leave, New Payroll Run/Process, etc.) are only reachable logged
// in as Arjun, regardless of real-world job title -- this is a real,
// verified product gap, not a test-writing mistake. See findings doc.
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
    localRole: "member" as const,
  },
  hr: {
    email: "sneha.reddy@meridian-construction.e2e-test.projexa-ai.com",
    password: PASSWORD,
    name: "Sneha Reddy",
    localRole: "member" as const,
  },
} as const;

export type UserKey = keyof typeof USERS;
