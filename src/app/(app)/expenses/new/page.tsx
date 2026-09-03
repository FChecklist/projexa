import ExpenseCreateClient from "@/components/ExpenseCreateClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// Real-screen conversion (2026-08-30): replaces the old "Log Expense"
// Dialog popup with a real create route.
export default async function ExpenseNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  // R67 D-70 (audit R-262): this used to `return` a bare Card holding
  // resolveSelectedProject's raw message, so an upstream failure replaced the
  // whole right pane with a bare HTTP status phrase -- no title, no Back, no
  // Retry, and no statement of what had failed. The screen's own frame is
  // rendered in every case now, with the failure reported inside it and a
  // Retry that re-runs the server fetch.
  if (errorMessage || !project) {
    return (
      <div className="flex-1">
        <CreateScreenUnavailable
          breadcrumb="Expenses / New Expense"
          title="New Expense"
          backHref="/expenses"
          backLabel="Back to Expenses"
          message={errorMessage}
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      <ExpenseCreateClient projectId={project.id} />
    </div>
  );
}
