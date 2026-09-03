import DesignStudioReviewClient from "@/components/DesignStudioReviewClient";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { requireAuth } from "@/lib/supabase/auth-guard";

// R67 WS-H (items H-03/H-04). The manager's review queue: submitted days
// grouped by designer, Approve per day, Return with a required reason.
//
// The role is read here, on the server, and passed down -- the client uses
// it only to DISABLE-WITH-REASON, never as the security boundary. The real
// gate is VERIDIAN's requireRole on the resolved acting user plus its own
// refusal of self-review, neither of which a hidden button would add to.
export default async function DesignStudioReviewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const ctx = await requireAuth();
  const { project, errorMessage } = await resolveSelectedProject(projectId, ctx.organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-8 text-center text-sm text-px-error">
            {errorMessage ?? "No active project selected. Pick a project to review its timesheets."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <DesignStudioReviewClient projectId={project.id} projectName={project.name} role={ctx.role} />
    </div>
  );
}
