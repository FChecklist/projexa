import { AppTopbar } from "@/components/AppTopbar";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import LabourClient from "@/components/LabourClient";

export default async function LabourPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const { project, errorMessage } = await resolveSelectedProject(projectId);

  return (
    <>
      <AppTopbar title="Manpower & Attendance" />
      <main className="flex-1 space-y-6 p-6">
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && <LabourClient projectId={project.id} />}
      </main>
    </>
  );
}
