import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import BudgetProjectClient from "@/components/BudgetProjectClient";
import PickProjectPrompt from "@/components/PickProjectPrompt";

// R67 lane D22 (item D-41, recs R-107/R-113): /budgets is now THE PROJECT'S
// BOQ BUDGET, not the org-wide ERP fiscal-year ledger (that moved intact to
// /accounting/annual-budgets). Project resolution is the same rule
// scope/page.tsx uses -- a ?projectId= in the URL wins over the rail's own
// selection, so a shared/bookmarked link opens the budget it names -- via the
// one shared resolveSelectedProject() helper rather than a second copy of the
// same /dashboard fetch.
export default async function ProjectBudgetPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Budget" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {/* NEVER "No budgets found." -- that sentence was the whole defect
            R-107 reported: an empty ledger where a project budget belonged.
            When nothing is selected the screen says what to do next and puts
            the cursor in the control that does it. */}
        {!errorMessage && !project && <PickProjectPrompt message="Pick a project in the top rail to see its budget" />}
        {project && (
          <div className="h-[calc(100vh-12rem)] min-h-[560px]">
            <BudgetProjectClient projectId={project.id} projectName={project.name} />
          </div>
        )}
      </div>
    </>
  );
}
