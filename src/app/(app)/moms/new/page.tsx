// R67 MERGE (lane D0 x lane F2). Lane F2's item F-19 (audit R-245) measured
// this create route at 1.5-1.65 s to first byte, for a form of three to seven
// fields, against /budgets/new's 184 ms -- because it awaited
// getServerOrganizationId() and then a VERIDIAN /dashboard call before emitting
// a byte. Its fix was to resolve the project from ?projectId= or the rail's
// cookie with NO network call.
//
// That fast path is NOT adopted here, and the reason is decision D-20, which
// this exact route is the strongest case for: minutes saved under a project
// nobody chose can be Published, which locks them server-side
// (assertEditable), so the mistake is not correctable in the product. The
// question "which project" must be ANSWERED, and answering it needs the
// project list. What F-19 asked for that can be had without weakening that is
// kept in full: the resolution moves inside a <Suspense> boundary, so the
// frame and the form's own skeleton paint at TTFB instead of a blank page, and
// only the fields wait.
import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/PageHeading";
import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { MOMS_TEXT } from "@/lib/moms-list";
import MoMCreateClient from "@/components/MoMCreateClient";
import { ScreenContext } from "@/components/shell/shell-screen-context";
import { CreateFormSkeleton } from "@/components/CreateFormSkeleton";

// R67 D-20. THE DEFECT: this route used to call resolveSelectedProject()
// with no opt-out, so arriving here with no ?projectId= silently resolved to
// the org's FIRST project and rendered a complete, ready-to-save form for
// it -- while the top rail said "All projects". Minutes for a Villa 21
// meeting could be created under Cedar Heights, and once Published they lock
// server-side (assertEditable in veri-meeting-service.ts), so the mistake is
// not correctable in the product.
//
// A create screen is exactly where a guessed scope is least acceptable, so
// this route now REQUIRES a project. With none, it renders the question and
// the list of projects to answer it with -- and no form at all, because a
// form the user cannot safely submit is worse than no form.
async function MoMNewSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const projectId = requestedProjectId;
  const organizationId = await getServerOrganizationId();
  // R67 D-20: this screen REQUIRES a project -- a meeting saved under a
  // silently-chosen one can be Published, which locks it server-side -- so it
  // declines the last-resort pick and asks instead. `projects` is what it asks
  // WITH, and `source` is what the shell's rail is told.
  const { project, projects, errorMessage, source } = await resolveSelectedProject(projectId, organizationId, {
    allProjectsWhenUnset: true,
  });

  // R67 MERGE (lane D1's D-70 x lane D0's D-20). The two branches below answer
  // two different questions and BOTH lanes were right about their own:
  //
  //  * The read FAILED -- D-70 (audit R-262). This used to `return` a bare Card
  //    holding resolveSelectedProject's raw message, so an upstream failure
  //    replaced the whole right pane with a bare HTTP status phrase: no title,
  //    no Back, no Retry, and no statement of what had failed. The screen's own
  //    frame is rendered now, with the failure reported inside it and a Retry
  //    that re-runs the server fetch.
  //  * The read SUCCEEDED and no project is in scope -- D-20. That is not an
  //    error and must not be dressed as one; the answer is the question itself
  //    plus the list to answer it with, which is lane D0's branch, kept whole.
  if (errorMessage) {
    return (
      <div className="flex-1">
        <CreateScreenUnavailable
          breadcrumb="Minutes of Meeting / New MoM"
          title="New Meeting"
          backHref="/moms"
          backLabel="Back to Minutes of Meeting"
          message={errorMessage}
        />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 space-y-4 p-6">
        <PageHeading title="New Meeting" />
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-px-ink">{MOMS_TEXT.noProjectOnCreate}</p>
            {projects.length > 0 ? (
              <>
                {/* The switcher, open. The top rail's own picker is the other
                    way in; this is the same choice, on the screen that needs
                    it, so the user is never left with a question and no
                    control to answer it. */}
                <ul className="divide-y divide-px-border rounded-lg border border-px-border">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/moms/new?projectId=${encodeURIComponent(p.id)}`}
                        className="block px-4 py-2.5 text-sm hover:bg-px-cloud/40"
                      >
                        <span style={{ color: "var(--color-veri-status-context)" }}>{p.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href="/moms" className="inline-block text-[12px] underline underline-offset-2 text-px-muted">
                  Back to Minutes of Meeting
                </Link>
              </>
            ) : (
              <p className="text-sm text-px-muted">
                This organisation has no projects yet, so there is nothing to record minutes against.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1">
      {/* R67 A-03: the create screen is inside one project too -- the shell's
          rail and strip must say which, not "All projects". */}
      <ScreenContext moduleId="moms" project={project} source={source ?? "auto"} />
      {/* R67 lane D22 (item D-63): the project's name is what makes the
          default title specific ("Skyline Tower A - site coordination"). */}
      <MoMCreateClient projectId={project.id} projectName={project.name} />
    </div>
  );
}

export default async function MoMNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <Suspense
      fallback={
        <div className="flex-1 space-y-4 p-6">
          <PageHeading title="New Meeting" />
          <CreateFormSkeleton fields={4} />
        </div>
      }
    >
      <MoMNewSection requestedProjectId={projectId} />
    </Suspense>
  );
}
