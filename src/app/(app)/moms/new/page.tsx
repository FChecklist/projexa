// R67 F-19 (audit recommendation R-245) / decision D-04.
//
// This create route awaited getServerOrganizationId() and then a VERIDIAN
// /dashboard call BEFORE emitting a byte -- 1.5-1.65 s to first byte for a
// form of three to seven fields, against /budgets/new's 184 ms, which skips
// the chain. Every navigation that reaches this screen (a "+ New" button, a
// KPI tile, a pill) already carries ?projectId=, and the rail's own
// veri.rail.project cookie covers a typed or bookmarked URL, so the project is
// now resolved with NO network call and the form renders straight away. The
// /dashboard hop survives only for the case where neither source knows, and it
// happens inside a Suspense boundary behind the form's own skeleton.
import { Suspense } from "react";
import MoMCreateClient from "@/components/MoMCreateClient";
import { CreateFormSkeleton, CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveProjectForModule, resolveProjectIdFastWithSource } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
// R67 A-03: a create screen is inside one project too, so the rail and the
// strip must name it rather than "All projects". Rendered inside a boundary --
// it needs the project's NAME, which the fast path deliberately does not have.
import { ModuleScreenContext } from "@/components/ModuleScreenContext";

async function ResolvedForm({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage, source } = await resolveProjectForModule(
    requestedProjectId,
    organizationId
  );
  if (!projectId) return <CreateProjectMissing message={errorMessage} />;
  return (
    <>
      <ModuleScreenContext
        moduleId="moms"
        projectId={projectId}
        organizationId={organizationId}
        source={source}
      />
      <MoMCreateClient projectId={projectId} />
    </>
  );
}

export default async function MomsNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  // No network: the query string, else the cookie the top rail wrote.
  const { projectId: known, source } = await resolveProjectIdFastWithSource(projectId);

  if (known) {
    return (
      <div className="flex-1">
        {/* The form does not wait for this: ScreenContext renders no DOM, and
            the name lookup it needs sits behind its own boundary. */}
        <Suspense fallback={null}>
          <ModuleScreenContext
            moduleId="moms"
            projectId={known}
            source={source === "url" ? "route" : "preference"}
          />
        </Suspense>
        <MoMCreateClient projectId={known} />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
      <Suspense fallback={<CreateFormSkeleton fields={4} />}>
        <ResolvedForm requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
