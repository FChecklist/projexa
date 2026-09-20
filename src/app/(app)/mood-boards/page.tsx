// Cold-load fix (owner-flagged "single biggest risk to a live demo",
// PROJEXA-E2E-001 work order section 5) -- same defect and same fix as
// meetings/page.tsx: see that file's header comment for the full rationale.
// Measured before/after: see src/components/MoodBoardsClient.tsx's own
// header comment.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { fetchMoodBoardsList } from "@/lib/module-list-source";
import MoodBoardsClient, { type MoodBoard } from "@/components/MoodBoardsClient";
import ProjectLoadError from "@/components/ProjectLoadError";

const SKELETON = (
  <div className="grid h-64 place-items-center" aria-busy="true">
    <Loader2 className="size-6 animate-spin text-px-muted" />
  </div>
);

async function MoodBoardsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  // See meetings/page.tsx's MeetingsSection for why cacheSeconds is
  // deliberately NOT passed here.
  const { project, errorMessage } = await resolveSelectedProject(requestedProjectId, organizationId);

  if (errorMessage) return <ProjectLoadError message={errorMessage} />;
  if (!project) {
    return <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>;
  }

  const list = await fetchMoodBoardsList<MoodBoard>(organizationId, project.id, "mood boards");

  return <MoodBoardsClient projectId={project.id} initial={list} />;
}

export default async function MoodBoardsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Mood Boards" />
      <Suspense fallback={SKELETON}>
        <MoodBoardsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
