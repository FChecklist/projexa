import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { fetchProjectProgressBars } from "@/lib/dashboard-overview";
import ProjectsOverviewClient, { type RegistryColumn } from "@/components/ProjectsOverviewClient";

// R46 P8 seq124 (M28 registry-model proof, same try/catch/404-is-not-an-error
// resolver shape as budgets/page.tsx's resolveBudgetsListColumns /
// scope/page.tsx's resolveBoqCompareColumns). function_id is
// "dashboard.overview", NOT "dashboard.dashboard" -- this task was
// originally assigned "dashboard.dashboard", but seq125 (PR #142, merged
// concurrently with this seq) already claimed that exact function_id for
// the DIFFERENT /dashboard/project screen (its columns are that screen's
// KPI-tile labels -- percentByValue/contractValue/budgetVsActual/etc,
// nothing to do with this page's project-progress-bar list). Reusing it
// here would have silently served /dashboard/project's labels onto this
// page, or raced with its resolver over which row is "the" global row for
// that id (both org_id IS NULL, no uniqueness constraint on function_id
// alone). "dashboard.overview" is a distinct id for a distinct screen, and
// leaves seq125's shipped row untouched. A missing or errored registry row
// is NOT fatal -- ProjectsOverviewClient falls back to its own hardcoded
// labels when this is null. Data fetching (fetchProjectProgressBars) is
// completely unrelated to this lookup and untouched by it.
async function resolveDashboardOverviewLabels(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/dashboard.overview", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[dashboard/overview/page] screen_definitions resolve failed, falling back to hardcoded labels:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function ProjectsOverviewPage() {
  const organizationId = await getServerOrganizationId();
  const [labels, { bars, errorMessage }] = await Promise.all([
    resolveDashboardOverviewLabels(organizationId),
    fetchProjectProgressBars(organizationId),
  ]);

  return <ProjectsOverviewClient bars={bars} errorMessage={errorMessage} labels={labels} />;
}
