"use client";

// R67 D-66 -- what a per-project module shows under "All projects".
//
// R-253: "a per-project module under 'All projects' renders a chooser card
// 'Materials are kept per project — pick a project to continue' with the
// switcher open and '+ New' disabled with the reason 'Pick a project first'."
//
// The alternative -- what the product did -- was to silently resolve
// projects[0] and render that project's rows under a rail that said "All
// projects". A user recording a variation on that screen recorded it against
// a project nobody chose. D-20 stopped the guess on the server; this is what
// the screen says instead.
//
// The list of projects is rendered INSIDE the card, not only behind the
// switcher, because a card that says "pick a project" and then makes the user
// hunt for the control is the same dead end in a politer voice.

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { useProjectScope } from "@/components/shell/project-context";

export function ProjectRequiredCard({
  /** The module's name as a plural subject: "Materials", "Permits". */
  module,
}: {
  module: string;
}) {
  const { projects, projectsLoaded, selectProject, openSwitcher } = useProjectScope();

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 p-6">
        <p className="flex items-start gap-2 text-sm text-ct-navy">
          <FolderOpen className="mt-0.5 size-4 shrink-0 text-px-muted" aria-hidden />
          {module} are kept per project — pick a project to continue
        </p>

        {projects.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Button variant="outline" size="sm" onClick={() => selectProject(p)}>
                  {p.name}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {projects.length === 0 && (
          // Honest either way: the org genuinely has none, or the list has
          // not answered yet. Neither is "pick one" with nothing to pick.
          <p className="text-sm text-px-muted">
            {projectsLoaded
              ? "No projects to choose from yet."
              : "Still loading the project list…"}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={openSwitcher}>
            Choose in the top bar
          </Button>
          {/* The module's own primary stays VISIBLE and disabled with its
              reason -- the repo-wide rule is that an action is disabled by
              condition, never hidden. */}
          <span className="inline-flex items-center gap-2">
            <Button size="sm" disabled>
              + New
            </Button>
            <span className="text-xs text-px-muted">Pick a project first</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default ProjectRequiredCard;
