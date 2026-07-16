import { AppTopbar } from "@/components/AppTopbar";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ReportsClient from "@/components/ReportsClient";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  // Priority 17 follow-on (projexa_reports_dispatch_2026_07_16): previously
  // this page refused to render ReportsClient at all when the org had no
  // projects yet, which would have also hidden the new org-wide "Full
  // Catalog" tab (report_definitions catalog -- does not need a project) --
  // a real regression for any org that has not created a project yet.
  // ReportsClient is now always rendered (projectId nullable); only its
  // "Project Reports" tab needs a project, and it shows its own honest
  // empty state when there is not one, instead of the whole page.
  return (
    <>
      <AppTopbar title="Reports" />
      <main className="flex-1 space-y-6 p-6">
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        <ReportsClient key={project?.id ?? "no-project"} projectId={project?.id ?? null} />
      </main>
    </>
  );
}
