"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Printer, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AiWorkLinkButtons } from "@/components/ai-link/AiWorkLinkButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceProjectSwitcher } from "@/components/workspace/WorkspaceProjectSwitcher";
import { LazyMount } from "@/components/workspace/LazyMount";
import { WorkspaceBoqCard } from "@/components/workspace/WorkspaceBoqCard";
import { WorkspaceRecordsCard } from "@/components/workspace/WorkspaceRecordsCard";
import { WorkspaceResourcesCard } from "@/components/workspace/WorkspaceResourcesCard";
import { WorkspaceInsightsCard } from "@/components/workspace/WorkspaceInsightsCard";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";
import SiteDiaryClient from "@/components/SiteDiaryClient";
import ScheduleGanttClient from "@/components/ScheduleGanttClient";
import MilestonesClient from "@/components/MilestonesClient";
import ChangeOrdersClient from "@/components/ChangeOrdersClient";
import RfisClient from "@/components/RfisClient";
import BillingMilestonesClient from "@/components/BillingMilestonesClient";
import { fetchJson } from "@/lib/fetch-json";
import { visibleWorkspaceSections, WORKSPACE_SECTIONS, type WorkspaceSectionKey } from "@/lib/workspace-visibility";
import type { SelectableProject } from "@/lib/project-selection";

// Owner directive 2026-09-19, "Merge 6 -- Ledger Dashboard": one scrollable
// page combining 11 existing domains for a single project, nav-pill
// anchors instead of route changes, real role-aware section visibility.
// Every section below embeds the REAL, already-shipped client component for
// that domain unchanged -- this file's own job is layout, the header, the
// nav strip, and which sections a given role sees, never a reimplementation
// of any one domain's own logic.
export default function ProjectWorkspaceClient({
  project,
  projects,
  role,
}: {
  project: SelectableProject;
  projects: SelectableProject[];
  role: string | null;
}) {
  const sections = visibleWorkspaceSections(role);
  const visible = (key: WorkspaceSectionKey) => sections.includes(key);

  const [percentComplete, setPercentComplete] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ percentByValue?: number }>(`/api/dashboard/project/${encodeURIComponent(project.id)}`)
      .then((data) => {
        if (!cancelled && typeof data.percentByValue === "number") setPercentComplete(data.percentByValue);
      })
      .catch(() => {
        /* the badge is informational -- a failed fetch just leaves it unshown, not an error banner on the whole page */
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link -- copy it from the address bar instead");
    }
  }

  return (
    <div className="flex-1">
      {/* STICKY HEADER */}
      <div className="sticky top-0 z-20 border-b border-px-border bg-px-cream/95 px-6 py-3 backdrop-blur print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-lg text-px-ink">{project.name}</h1>
            {percentComplete !== null && (
              <Badge variant="secondary" data-testid="workspace-completion-badge">
                {Math.round(percentComplete)}% complete
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <WorkspaceProjectSwitcher projectId={project.id} initialProjects={projects} />
            <AiWorkLinkButtons role={role} project={{ id: project.id, name: project.name }} />
            <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="workspace-print">
              <Printer className="size-3.5" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={handleShare} data-testid="workspace-share">
              <Share2 className="size-3.5" /> Share
            </Button>
          </div>
        </div>
        {/* NAV PILLS -- same-page anchors, no route change */}
        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="Workspace sections">
          {WORKSPACE_SECTIONS.filter((s) => visible(s.key)).map((s) => (
            <a
              key={s.key}
              href={`#${s.key}`}
              className="rounded-full border border-px-border px-3 py-1 text-xs text-px-muted hover:border-px-teal hover:text-px-teal"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="space-y-6 p-6">
        {visible("progress") && (
          <section id="progress">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Progress (WPR)</CardTitle></CardHeader>
              <CardContent><LazyMount><WorkProgressReportClient projectId={project.id} projectName={project.name} embedded /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("site-diary") && (
          <section id="site-diary">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Site Diary</CardTitle></CardHeader>
              <CardContent><LazyMount><SiteDiaryClient projectId={project.id} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("boq") && (
          <section id="boq">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">BOQ</CardTitle></CardHeader>
              <CardContent><LazyMount><WorkspaceBoqCard projectId={project.id} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("timeline") && (
          <section id="timeline">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Timeline</CardTitle></CardHeader>
              <CardContent><LazyMount><ScheduleGanttClient projectId={project.id} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {/* R-94: Timeline and Milestones stay two distinct sections -- never
            merged into one tab-switcher, per the requirement's own wording. */}
        {visible("milestones") && (
          <section id="milestones">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Milestones</CardTitle></CardHeader>
              <CardContent><LazyMount><MilestonesClient projectId={project.id} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("scope-change-orders") && (
          <section id="scope-change-orders">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Scope &amp; Change Orders</CardTitle></CardHeader>
              <CardContent><LazyMount><ChangeOrdersClient projectId={project.id} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("rfis") && (
          <section id="rfis">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">RFIs</CardTitle></CardHeader>
              <CardContent><LazyMount><RfisClient projectId={project.id} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("billing-milestones") && (
          <section id="billing-milestones">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Billing Milestones</CardTitle></CardHeader>
              <CardContent><LazyMount><BillingMilestonesClient projectId={project.id} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("resources") && (
          <section id="resources">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Resources</CardTitle></CardHeader>
              <CardContent><LazyMount><WorkspaceResourcesCard projectId={project.id} projectName={project.name} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("records") && (
          <section id="records">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="font-heading text-base">Records</CardTitle></CardHeader>
              <CardContent><LazyMount><WorkspaceRecordsCard projectId={project.id} projectName={project.name} /></LazyMount></CardContent>
            </Card>
          </section>
        )}

        {visible("insights") && (
          <section id="insights">
            <h2 className="mb-2 font-heading text-base text-px-ink">Insights</h2>
            <LazyMount minHeight={200}>
              <WorkspaceInsightsCard projectId={project.id} projectName={project.name} />
            </LazyMount>
          </section>
        )}
      </div>
    </div>
  );
}
