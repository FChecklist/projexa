import type { OrgRole } from "@/lib/authz/roles";

// Owner directive 2026-09-19 ("Merge 6" single-project workspace). A pure
// function, not inlined into the client component, so the exact per-role
// section list is unit-testable without a DOM -- same discipline this
// codebase already holds submitFailure()/chooseProject() to.
//
// PROJEXA's role axis is a SET model, not a linear rank (roles.ts's own
// comment: "client_viewer is not 'below' site_engineer, they restrict along
// different axes") -- so this is a literal per-role table, not a threshold
// check against ROLE_GROUPS. Cost-visibility (a separate per-role GRANT,
// entirely enforced server-side in compliance-tracker -- see
// cost-visibility-service.ts) is deliberately NOT modelled here: PROJEXA has
// no client-visible signal for "does this member have the grant" (confirmed
// by investigation -- canRoleSeeCost/applyCostVisibility never run on this
// side), so the BOQ section is shown to every role the table below names,
// and the SAME server-side redaction BoqDualViewGrid already trusts (R-50's
// hard floor: money fields are structurally absent from the API response,
// not hidden by a client check) decides how much of it that person actually
// sees. This section visibility table only ever answers "should this role
// see the section AT ALL", never "how much of it".
export type WorkspaceSectionKey =
  | "progress"
  | "site-diary"
  | "boq"
  | "timeline"
  | "milestones"
  | "scope-change-orders"
  | "rfis"
  | "billing-milestones"
  | "resources"
  | "records"
  | "insights";

export const WORKSPACE_SECTIONS: readonly { key: WorkspaceSectionKey; label: string }[] = [
  { key: "progress", label: "Progress (WPR)" },
  { key: "site-diary", label: "Site Diary" },
  { key: "boq", label: "BOQ" },
  { key: "timeline", label: "Timeline" },
  { key: "milestones", label: "Milestones" },
  { key: "scope-change-orders", label: "Scope & Change Orders" },
  { key: "rfis", label: "RFIs" },
  { key: "billing-milestones", label: "Billing Milestones" },
  { key: "resources", label: "Resources" },
  { key: "records", label: "Records" },
  { key: "insights", label: "Insights" },
];

const ALL_SECTIONS: readonly WorkspaceSectionKey[] = WORKSPACE_SECTIONS.map((s) => s.key);

// PM/Owner-equivalent authority: every section.
const OWNER_ADMIN_PM: readonly WorkspaceSectionKey[] = ALL_SECTIONS;

// Field roles: what's actually recorded/consumed on site, plus the two
// schedule-adjacent read surfaces (Timeline/Milestones) every role gets.
const SITE_ENGINEER: readonly WorkspaceSectionKey[] = [
  "progress",
  "site-diary",
  "timeline",
  "milestones",
  "rfis",
  "resources",
  "records",
];

// A `member` granted cost-visibility acts as "Finance" here -- money,
// contracts, schedule authority, but never the field-recording surfaces or
// the org's records/resources.
const MEMBER_FINANCE: readonly WorkspaceSectionKey[] = [
  "boq",
  "timeline",
  "milestones",
  "scope-change-orders",
  "billing-milestones",
  "insights",
];

// client_viewer: the same commercial surfaces as member/Finance minus
// Insights (a client does not get the org's own P&L/exceptions view) --
// never Resources/Records/Site Diary/RFIs.
const CLIENT_VIEWER: readonly WorkspaceSectionKey[] = [
  "boq",
  "timeline",
  "milestones",
  "scope-change-orders",
  "billing-milestones",
];

/**
 * The real per-role section list. `role` is PROJEXA's own `memberships.role`
 * (requireAuth()'s `ctx.role`) -- `null` (no resolved membership) sees
 * nothing, the same fail-closed default `requireRole()` itself uses.
 */
export function visibleWorkspaceSections(role: string | null): readonly WorkspaceSectionKey[] {
  switch (role as OrgRole | null) {
    case "owner":
    case "admin":
    case "pm":
      return OWNER_ADMIN_PM;
    case "site_engineer":
      return SITE_ENGINEER;
    case "member":
      return MEMBER_FINANCE;
    case "client_viewer":
      return CLIENT_VIEWER;
    default:
      return [];
  }
}

export function canSeeWorkspaceSection(role: string | null, section: WorkspaceSectionKey): boolean {
  return visibleWorkspaceSections(role).includes(section);
}
