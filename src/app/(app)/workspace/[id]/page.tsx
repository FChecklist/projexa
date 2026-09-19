import { Card, CardContent } from "@/components/ui/card";
import { resolveRouteProject } from "@/lib/project-selection";
import { requireAuth } from "@/lib/supabase/auth-guard";
import ProjectWorkspaceClient from "@/components/ProjectWorkspaceClient";

// Owner directive 2026-09-19 (relayed via a peer session's "Merge 6 --
// Ledger Dashboard" design pass): one scrollable page combining Progress,
// Site Diary, BOQ, Timeline, Milestones, Scope & Change Orders, RFIs,
// Billing Milestones, Resources, Records and Insights for ONE project, with
// nav-pill anchors instead of route changes. Purely additive -- every
// existing module page (/schedule, /scope, /change-orders,
// /billing-milestones, /materials, /site-diary, /rfis, /analysis, ...) is
// untouched and still fully reachable; this is a new, alternate way in.
//
// The project id is a REAL PATH SEGMENT (not ?projectId=), so this page has
// its own real, shareable, bookmarkable URL per project -- resolveRouteProject
// (A-13) is the one resolver in this codebase built for exactly that shape
// ("the project a screen that belongs to ONE project must use"), reading
// STRICTLY from the object the page is about rather than picking one for the
// user the way the ~50 resolveSelectedProject() callers do.
//
// Role-based section visibility is computed HERE, server-side, from the
// real requireAuth() role (PROJEXA's own memberships.role, not VERIDIAN's) --
// not a client-side afterthought -- so a role that cannot see a section never
// receives its markup at all, the same discipline the R-50 BOQ cost-visibility
// floor already holds compliance-tracker to for money fields.
export default async function ProjectWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // requireAuth()'s `response` is API-route territory (a NextResponse is not
  // a valid page return) -- middleware.ts already gates every (app) page
  // before it renders, so every other page.tsx in this codebase reads
  // organizationId/role off this same call without checking `response`
  // (see getServerOrganizationId()'s own identical shape).
  const ctx = await requireAuth();

  const selection = await resolveRouteProject(undefined, id, ctx.organizationId);

  if (selection.unreachable) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">This project could not be found, or you do not have access to it.</CardContent></Card>
      </div>
    );
  }
  if (selection.errorMessage || !selection.project) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{selection.errorMessage ?? "This project could not be loaded."}</CardContent></Card>
      </div>
    );
  }

  return (
    <ProjectWorkspaceClient
      project={selection.project}
      projects={selection.projects}
      role={ctx.role}
    />
  );
}
