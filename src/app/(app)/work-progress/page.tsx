import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import WorkProgressTabsClient from "@/components/WorkProgressTabsClient";

// R67 F-05 (R-075) / F-03. Two costs removed before any HTML is sent:
// resolveSelectedProject() no longer goes through VERIDIAN's 1.4-4.0 s
// /dashboard aggregate (it uses the cheap /projects read), and the
// data-dependent subtree is behind <Suspense> so the heading streams first.
//
// The tabs themselves moved into a client component so all three can share one
// WorkProgressDataProvider: Analytics used to re-run Daily Entry's entire
// load chain on every tab switch.
export default async function WorkProgressPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Work Progress" />
      <Suspense fallback={<Card><CardContent className="p-8 text-center text-sm text-px-muted">Loading project…</CardContent></Card>}>
        <WorkProgressSection projectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}

async function WorkProgressSection({ projectId, tab }: { projectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
      </Card>
    );
  }
  if (!project) {
    return <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>;
  }
  return <WorkProgressTabsClient projectId={project.id} tab={tab} />;
}
