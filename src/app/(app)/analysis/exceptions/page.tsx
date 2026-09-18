import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/PageHeading";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ExceptionsClient from "@/components/ExceptionsClient";

// Sumeet requirement (new, 2026-09-18): the 28-item deterministic exceptions
// report, listed from /analysis alongside Project 360 Analysis. Same thin-
// route convention as every other project-scoped page.tsx here.
export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Exceptions" />
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Exceptions" />
      <p className="text-sm text-px-muted">{project.name} — 28 deterministic checks for the real-world failure modes construction projects run into.</p>
      <ExceptionsClient projectId={project.id} />
    </div>
  );
}
