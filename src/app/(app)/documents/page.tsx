import { AppTopbar } from "@/components/AppTopbar";
import { Card, CardContent } from "@/components/ui/card";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import DocumentsClient from "@/components/DocumentsClient";

type OrgDashboard = { projects: { id: string; name: string }[] };

export default async function DocumentsPage() {
  let project: { id: string; name: string } | null = null;
  let errorMessage: string | null = null;

  try {
    const data = await callVeridian<OrgDashboard>("/dashboard");
    project = data.projects[0] ?? null;
  } catch (err) {
    errorMessage = err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN";
  }

  return (
    <>
      <AppTopbar title="Documents" />
      <main className="flex-1 space-y-6 p-6">
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && <DocumentsClient projectId={project.id} />}
      </main>
    </>
  );
}
