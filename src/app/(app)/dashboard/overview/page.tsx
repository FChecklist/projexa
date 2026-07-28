import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type OrgDashboard = { projects: { id: string; name: string }[] };
type ProjectDashboard = { projectId: string; progressPercent: number };

// The lightweight multi-project overview from the Owner's sketch: one
// horizontal status bar per project, % complete only -- deliberately a
// separate, simpler screen from /dashboard/hierarchy's full Company ->
// Department -> Project drill-down (Revenue/Budget/Expense/date-range/
// category charts), not folded into it. Real percentComplete per project,
// sourced the same way the drill-down Details view's Progress figure is
// (getProjectDashboard's "latest logged entry per activity, averaged").
export default async function ProjectsOverviewPage() {
  let bars: { id: string; name: string; progressPercent: number }[] = [];
  let errorMessage: string | null = null;

  try {
    const organizationId = await getServerOrganizationId();
    const orgDashboard = await callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined });
    const withProgress = await Promise.all(
      orgDashboard.projects.map(async (p) => {
        try {
          const detail = await callVeridian<ProjectDashboard>(`/dashboard/${p.id}`, { organizationId: organizationId ?? undefined });
          return { id: p.id, name: p.name, progressPercent: detail.progressPercent };
        } catch {
          return { id: p.id, name: p.name, progressPercent: 0 };
        }
      })
    );
    bars = withProgress;
  } catch (err) {
    errorMessage = err instanceof VeridianApiError ? err.message : "Failed to load project progress";
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeading title="Projects Overview" />
      {errorMessage && <p className="text-sm text-px-error">Could not load live data: {errorMessage}</p>}
      <Card className="shadow-card">
        <CardContent className="space-y-5 pt-6">
          {bars.length === 0 ? (
            <p className="py-8 text-center text-sm text-px-muted">No active projects yet.</p>
          ) : (
            bars.map((p) => (
              <div key={p.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-px-muted">{p.progressPercent}%</span>
                </div>
                <Progress value={p.progressPercent} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
