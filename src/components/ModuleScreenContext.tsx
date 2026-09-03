// R67 F-18 x WS-A (A-03/A-04) -- HOW THE FAST PATH STILL TELLS THE RAIL.
//
// THE TENSION THESE TWO ITEMS CREATE. A-03 has every module page render
// <ScreenContext/> so the shell's rail and the composer's strip name the same
// project the pane is showing, instead of "All projects" beside one project's
// meetings. To do that ScreenContext needs the project's NAME. F-18 exists to
// stop these pages awaiting /dashboard before they render anything: it resolves
// the project id from the URL or the rail's cookie with NO network call, and
// the name is the one thing that fast path cannot know.
//
// Resolving the name up front would put the round trip F-18 removed straight
// back on the critical path, on every module page.
//
// THE RESOLUTION. The publication is split from the pane. The pane renders
// immediately from the id. THIS component -- which renders no DOM at all,
// ScreenContext returns null -- resolves the name from the same 60 s per-org
// cache the page already consults and publishes it. It is rendered INSIDE the
// page's <Suspense> boundary, so it delays nothing the user can see: the frame,
// the tabs, the column heads and the skeleton rows are already on screen while
// this resolves.
//
// The rail therefore names the project no later than it did before this lane
// (A-03's own pages awaited resolveSelectedProject() before rendering a single
// element), and the pane paints a great deal sooner.
//
// WHEN THE NAME CANNOT BE FOUND, this publishes nothing rather than inventing a
// label. ScreenContext already treats a project with no name as no project, and
// a rail reading "All projects" is a visibly incomplete answer; a rail reading
// the project id, or an empty name, is a wrong one.
import { getProjectName } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { ScreenContext, type ScreenProjectSource } from "@/components/shell/shell-screen-context";

export async function ModuleScreenContext({
  moduleId,
  projectId,
  organizationId,
  source,
}: {
  moduleId: string;
  projectId: string | null;
  /**
   * Omit it on a page whose fast path has not resolved the org -- this
   * component then resolves it itself. getServerOrganizationId() is cache()'d
   * per request (F-30), so a page that DOES pass it pays nothing twice and a
   * page that does not pays one shared lookup.
   */
  organizationId?: string | null;
  /** A-04's vocabulary, from resolveProjectForModule(). */
  source: ScreenProjectSource | null;
}) {
  if (!projectId) return <ScreenContext moduleId={moduleId} project={null} source="auto" />;
  const org = organizationId === undefined ? await getServerOrganizationId() : organizationId;
  const name = await getProjectName(projectId, org);
  if (!name) return <ScreenContext moduleId={moduleId} project={null} source="auto" />;
  return (
    <ScreenContext
      moduleId={moduleId}
      project={{ id: projectId, name }}
      source={source ?? "auto"}
    />
  );
}
