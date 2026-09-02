"use client";

// R67 D-38 (audit R-097/R-101). /materials used to call resolveSelectedProject()
// and take projects[0] without saying so, which is how every capture in the
// audit shows "All projects" in the top rail above one project's rows. This
// component is what the screen renders INSTEAD of another project's rows when
// nothing has actually chosen one.
//
// PRECEDENCE, consumed not re-implemented: the URL wins. materials/page.tsx
// resolves ?projectId= server-side and never renders this component when one is
// present. This is only the "and if the URL says nothing?" branch, and its
// first act is to ask the rail (src/lib/rail-project.ts) -- if the rail holds a
// selection, the screen goes straight there instead of asking a question the
// user has already answered.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading, type PageHeadingAction } from "@/components/PageHeading";
import { readRailProject, writeRailProject } from "@/lib/rail-project";
import type { SelectableProject } from "@/lib/project-selection";

export const CHOOSER_PROMPT = "Materials are kept per project — pick a project to continue";
export const NO_PROJECT_REASON = "Pick a project first";

export default function MaterialsProjectChooser({
  projects,
  tab,
}: {
  projects: SelectableProject[];
  /** Carried through so the chooser lands the user on the tab they asked for. */
  tab?: string;
}) {
  const router = useRouter();
  // Deliberately NOT read during render: sessionStorage does not exist on the
  // server, so reading it in a useState initialiser would make the SSR pass and
  // the hydration pass disagree. One tick of "checking" is the honest cost.
  const [phase, setPhase] = useState<"checking" | "choose">("checking");

  useEffect(() => {
    const railProjectId = readRailProject();
    if (railProjectId && projects.some((p) => p.id === railProjectId)) {
      router.replace(hrefFor(railProjectId, tab));
      return;
    }
    setPhase("choose");
  }, [projects, router, tab]);

  function choose(projectId: string) {
    // Store it as the rail's selection, so the top rail and this screen name the
    // same project from here on, then put it in the URL, which is what every
    // other screen reads.
    writeRailProject(projectId);
    router.replace(hrefFor(projectId, tab));
  }

  const blockedActions: PageHeadingAction[] = [
    { label: "Filter", disabledReason: NO_PROJECT_REASON },
    { label: "Export", disabledReason: NO_PROJECT_REASON },
    { label: "+ New Material", variant: "default", disabledReason: NO_PROJECT_REASON, testId: "materials-new" },
  ];

  return (
    <div className="space-y-4">
      <PageHeading title="Materials" breadcrumb="Materials" actions={blockedActions} />

      <Card className="shadow-card">
        <CardContent className="space-y-4 p-6">
          {phase === "checking" ? (
            <p role="status" className="text-sm text-px-muted">Checking which project is selected…</p>
          ) : (
            <>
              <p className="text-sm text-ct-navy">{CHOOSER_PROMPT}</p>
              <ul className="flex flex-col gap-1">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => choose(project.id)}
                    >
                      {project.name}
                    </Button>
                  </li>
                ))}
              </ul>
              {/* Both writes stay RENDERED and say why they cannot be used --
                  a module whose actions vanish looks like a module that has
                  none. */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" disabled title={NO_PROJECT_REASON}>
                  {`Record Receipt (${NO_PROJECT_REASON})`}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function hrefFor(projectId: string, tab?: string): string {
  const params = new URLSearchParams({ projectId });
  if (tab) params.set("tab", tab);
  return `/materials?${params.toString()}`;
}
