"use client";

// PROJEXA-BUILD-002 WP-08 (AW-405, AW-406). The two entry points to the AI work link feature, gated by role:
//   "AI work link for this project"   the one-click mint/copy/confirm path (AiWorkLinkCompact.tsx), for the project the screen is
//                                      showing (the shell's selected project, or the workspace's). RENAMED 2026-09-29 (WO ai-work-
//                                      link-ui-and-projects-tab) from the plain "AI work link" -- see that component's own header
//                                      for the one-click behaviour this label now sits on top of.
//   "New project with my AI"          opens AiWorkLinkDialog in its new-project mode. It needs no project, so it is offered where a
//                                      person is choosing one, and it is NOT part of the one-click change: making a new project is
//                                      not a "safe default" action the way minting a read-and-draft link to an EXISTING project is,
//                                      so it keeps opening the full dialog exactly as before.
// A role below the member line (the read-only client_viewer) sees no button and a plain sentence saying why. While the role is not known
// yet nothing is drawn, so a button never flashes up and then goes away. The rule lives in ai-work-link-access.ts; the database is the gate.
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiWorkLinkCompact } from "@/components/ai-link/AiWorkLinkCompact";
import { AiWorkLinkDialog, type AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import { AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { getAwlClient, type AwlClient } from "@/lib/ai-work-link-client";

export function AiWorkLinkButtons({
  role,
  project,
  showNewProject = false,
  showMainTrigger = true,
  compact = false,
  onProjectCreated,
  client,
}: {
  /** The person's PROJEXA role, or null/undefined while it is not known yet. */
  role: string | null | undefined;
  /** The project on screen, or null when none is selected. */
  project: AiLinkProject | null;
  showNewProject?: boolean;
  /** WO ai-work-link-ui-and-projects-tab (2026-09-29). False on a screen with no single project of its own to point the main trigger
   *  at (ProjectsListClient.tsx's "New project with my AI" button, next to the list's New action) -- there, a disabled "AI work
   *  link for this project" button with no project in scope would be confusing chrome, not a real affordance, so this hides it and
   *  renders only the new-project button + its dialog. Every existing caller leaves this at its default (true) and is unaffected. */
  showMainTrigger?: boolean;
  /** The top rail is narrow: the button labels give way to icons below a wide screen, and the role sentence is only shown on a wide one. */
  compact?: boolean;
  onProjectCreated?: (project: AiLinkProject) => void;
  /** The service client. The default is the signed-in browser's. */
  client?: AwlClient;
}) {
  // Only "New project with my AI" opens a dialog from THIS component now -- the main trigger's own dialog (the "Change access or
  // expiry" escape hatch) lives inside AiWorkLinkCompact and is not this component's state to hold.
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const awl = client ?? getAwlClient();

  if (!role) return null;
  if (!canMakeAiWorkLink(role)) {
    return (
      <p className={compact ? "hidden text-xs text-muted-foreground xl:block" : "text-xs text-muted-foreground"} data-testid="ai-work-link-role-note">
        {AI_WORK_LINK_ROLE_NOTE}
      </p>
    );
  }

  const label = compact ? "hidden xl:inline" : "";
  return (
    <>
      <div className="flex items-center gap-1" data-testid="ai-work-link-buttons">
        {showMainTrigger && (
          <AiWorkLinkCompact role={role} project={project} client={awl} triggerLabel="AI work link for this project" compact={compact} />
        )}
        {showNewProject && (
          <Button type="button" variant="outline" size="sm" onClick={() => setNewProjectOpen(true)} aria-label="New project with my AI" data-testid="ai-new-project-open">
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span className={label}>New project with my AI</span>
          </Button>
        )}
      </div>
      <AiWorkLinkDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        mode="new-project"
        project={null}
        client={awl}
        onProjectCreated={onProjectCreated}
      />
    </>
  );
}
