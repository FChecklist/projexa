"use client";

// PROJEXA-BUILD-002 WP-08 (AW-405, AW-406). The two entry points to the AI work link dialog, gated by role:
//   "AI work link"            opens the dialog for the project the screen is showing (the shell's selected project, or the workspace's).
//   "New project with my AI"  opens the dialog in its new-project mode. It needs no project, so it is offered where a person is choosing one.
// A role below the member line (the read-only client_viewer) sees no button and a plain sentence saying why. While the role is not known
// yet nothing is drawn, so a button never flashes up and then goes away. The rule lives in ai-work-link-access.ts; the database is the gate.
import { useState } from "react";
import { Link2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiWorkLinkDialog, type AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import { AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { getAwlClient, type AwlClient } from "@/lib/ai-work-link-client";

export function AiWorkLinkButtons({
  role,
  project,
  showNewProject = false,
  compact = false,
  onProjectCreated,
  client,
}: {
  /** The person's PROJEXA role, or null/undefined while it is not known yet. */
  role: string | null | undefined;
  /** The project on screen, or null when none is selected. */
  project: AiLinkProject | null;
  showNewProject?: boolean;
  /** The top rail is narrow: the button labels give way to icons below a wide screen, and the role sentence is only shown on a wide one. */
  compact?: boolean;
  onProjectCreated?: (project: AiLinkProject) => void;
  /** The service client. The default is the signed-in browser's. */
  client?: AwlClient;
}) {
  const [dialog, setDialog] = useState<"project" | "new-project" | null>(null);

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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDialog("project")}
          disabled={!project}
          title={project ? undefined : "Select a project first"}
          aria-label="AI work link"
          data-testid="ai-work-link-open"
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          <span className={label}>AI work link</span>
        </Button>
        {showNewProject && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("new-project")} aria-label="New project with my AI" data-testid="ai-new-project-open">
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span className={label}>New project with my AI</span>
          </Button>
        )}
      </div>
      <AiWorkLinkDialog
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        mode={dialog ?? "project"}
        project={project}
        client={client ?? getAwlClient()}
        onProjectCreated={onProjectCreated}
      />
    </>
  );
}
