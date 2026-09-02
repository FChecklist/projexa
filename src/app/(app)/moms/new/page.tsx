import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/PageHeading";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { MOMS_TEXT } from "@/lib/moms-list";
import MoMCreateClient from "@/components/MoMCreateClient";

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
export default async function MoMNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, projects, errorMessage } = await resolveSelectedProject(projectId, organizationId, {
    allProjectsWhenUnset: true,
  });

  if (errorMessage) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">{errorMessage}</CardContent>
        </Card>
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
      <MoMCreateClient projectId={project.id} projectName={project.name} />
    </div>
  );
}
