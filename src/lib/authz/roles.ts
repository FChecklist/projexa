// PROJEXA-native tenant roles, split out of src/lib/supabase/auth-guard.ts so
// that code which must run in the Edge runtime (src/middleware.ts) can import
// the role vocabulary WITHOUT dragging in auth-guard's `next/headers`-backed
// Supabase server client, which is Node-only. auth-guard.ts re-exports
// everything below unchanged, so every existing `from "@/lib/supabase/auth-guard"`
// import keeps working -- this file has no imports of its own, by design.
//
// The role axis itself is unchanged and is documented in full in auth-guard.ts:
// it is backed by `memberships.role` (drizzle/0001_projexa_tenant_schema.sql,
// extended by drizzle/0012_membership_roles_pm_site_engineer.sql) and is
// PROJEXA's own, separate from VERIDIAN's user_role enum, because PROJEXA
// server routes call VERIDIAN with one shared per-org API key rather than a
// per-user VERIDIAN identity -- so a per-user role gate has to live on this
// side to have any effect at all.
export type OrgRole = "owner" | "admin" | "pm" | "site_engineer" | "member" | "client_viewer";

// The full set `memberships.role`'s check constraint allows -- the runtime
// counterpart to the type above, for validating a role received over the wire.
export const ALL_ORG_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "pm",
  "site_engineer",
  "member",
  "client_viewer",
];

// Named role sets for requireRole() call sites. Ordered loosely from most to
// least restrictive, but deliberately NOT a linear rank: client_viewer is not
// "below" site_engineer, they restrict along different axes (read-only vs.
// field-scoped), which is exactly why this is a set model and not a number.
export const ROLE_GROUPS = {
  // Org-membership management, org security/compliance posture, HR + payroll
  // master data. owner/admin only.
  ORG_ADMIN: ["owner", "admin"] as const,
  // Financial / contractual / commercial / schedule authority: budgets, change
  // orders, purchase orders, invoices, BOQ scope, baselines. Deliberately
  // excludes site_engineer and client_viewer.
  PM_OR_ABOVE: ["owner", "admin", "pm"] as const,
  // Site diary / punch list / progress entry: anyone actually doing on-site
  // work. Excludes the legacy `member` role and read-only client_viewer.
  FIELD: ["owner", "admin", "pm", "site_engineer"] as const,
  // Self-service actions a person performs on their OWN record -- filing their
  // own leave request, logging their own time, their own to-dos. Every real
  // role except the read-only client_viewer.
  ANY_MEMBER: ["owner", "admin", "pm", "site_engineer", "member"] as const,
  // Actions every authenticated member of the org may take regardless of role,
  // including a client_viewer: marking a notification read, replying in a
  // conversation, accepting an invite addressed to them.
  ANY_ROLE: ALL_ORG_ROLES,
};

export type RoleGroupName = keyof typeof ROLE_GROUPS;
