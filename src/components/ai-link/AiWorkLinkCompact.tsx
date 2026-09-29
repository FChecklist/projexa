"use client";

// PROJEXA -- WO ai-work-link-ui-and-projects-tab (2026-09-29). THE ONE-CLICK AI WORK LINK, and the ONE place that behaviour lives.
//
// AGREED DESIGN (several rounds of mockups, this session -- see AiWorkLinkButtons.tsx's own header for the two entry points this
// replaces): clicking used to always open AiWorkLinkDialog and make the person pick a level, a duration and read a server-fetched
// warning before Create was even enabled. The new default path is one click: mint immediately with the safe defaults -- level 0
// ("Read and draft", never "Direct entries") and 7 days -- copy the link straight to the clipboard, and show a small inline
// confirmation IN PLACE OF THE BUTTON, not a modal. Nothing about the warning-before-write safety gate is removed: the FULL picker
// (level/duration, the DB-sourced warning, Create) is one click away behind "Change access or expiry", which opens the exact same
// AiWorkLinkDialog this file used to open unconditionally -- the gate becomes optional rather than the default path, per the owner's
// own framing of this change.
//
// ONE COMPONENT, THREE CALL SITES. This is deliberately the ONLY place that mints with the one-click defaults and renders the
// confirmation sentence, reused byte-for-byte by:
//   - AiWorkLinkButtons.tsx      the top-rail "AI work link for this project" trigger
//   - ProjectsListClient.tsx     each row's "Copy AI work link" action
//   - M24Shell.tsx               the left-panel "Work on this project with any AI" banner
// A caller that needs a different label passes `triggerLabel`; nothing else about the mint-copy-confirm behaviour varies by caller,
// which is the point -- three call sites drifting into three slightly different implementations is exactly what this file exists to
// prevent.
//
// ROLE GATING IS SELF-CONTAINED. Earlier, only AiWorkLinkButtons checked canMakeAiWorkLink(); the row action and the banner have no
// other component gating them, so this component checks it itself (same helper, same sentence, same "say nothing while role is still
// unknown" rule AiWorkLinkButtons.tsx has always followed) rather than trusting three different callers to remember to.
import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiWorkLinkDialog, type AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import { AI_ASSISTANT_NAMES, AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { AwlError, getAwlClient, type AwlClient } from "@/lib/ai-work-link-client";

/** The safe defaults the one-click path mints with -- level 0 ("Read and draft", AiWorkLinkDialog.tsx's LEVEL_LABEL[0]) and 7 days.
 *  Exported so the confirmation sentence below and this file's own tests stay honest about what was actually minted rather than
 *  each restating "7 days" as a separate literal. */
export const AWL_ONE_CLICK_LEVEL = 0 as const;
export const AWL_ONE_CLICK_DAYS = 7 as const;

function mintErrorMessage(error: unknown): string {
  if (error instanceof AwlError) return error.message;
  return "Could not create the link. Try again.";
}

export function AiWorkLinkCompact({
  role,
  project,
  client,
  triggerLabel = "AI work link",
  className,
}: {
  /** The person's PROJEXA role, or null/undefined while it is not known yet -- see ai-work-link-access.ts. */
  role: string | null | undefined;
  /** The project this link is for, or null when none is selected (the trigger is disabled, matching the pre-existing button's own
   *  "Select a project first" behaviour). */
  project: AiLinkProject | null;
  /** The service client. The default is the signed-in browser's, same as every other AI work link surface. */
  client?: AwlClient;
  /** The trigger's visible label. Each of the 3 call sites names its own ("AI work link for this project", "Copy AI work link",
   *  ...) -- see this file's header for why the BEHAVIOUR behind the label never varies by caller. */
  triggerLabel?: string;
  className?: string;
}) {
  const [phase, setPhase] = useState<"idle" | "minting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // "Change access or expiry" opens the real dialog in ITS project mode -- the same warning-before-write mechanism this component's
  // own one-click path makes optional, never removed. Reachable both before minting (the error state's own escape hatch) and after.
  const [dialogOpen, setDialogOpen] = useState(false);
  const awl = client ?? getAwlClient();

  // Same "say nothing while unknown, say why once known" rule as AiWorkLinkButtons.tsx -- a button must never flash up and then
  // disappear once the real role answer arrives.
  if (!role) return null;
  if (!canMakeAiWorkLink(role)) {
    return (
      <p className={className} data-testid="awl-compact-role-note">
        {AI_WORK_LINK_ROLE_NOTE}
      </p>
    );
  }

  async function copyOneClick() {
    if (!project || phase === "minting") return;
    setPhase("minting");
    setError(null);
    try {
      const made = await awl.mint({ projectId: project.id, level: AWL_ONE_CLICK_LEVEL, days: AWL_ONE_CLICK_DAYS });
      try {
        await navigator.clipboard.writeText(made.link);
      } catch {
        // Clipboard denied/unavailable (e.g. an insecure context, or the permission refused): the link itself was still made and
        // is not lost -- "Change access or expiry" below opens the real dialog, whose own Input+Copy control (AiWorkLinkDialog.tsx's
        // ResultPanel) is the manual fallback this project has always had for exactly this case.
      }
      setPhase("done");
    } catch (e) {
      setError(mintErrorMessage(e));
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <div className={className} data-testid="awl-compact-confirm">
        <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--color-veri-teal, #0E7C6E)" }}>
          <Check className="size-3.5" aria-hidden="true" /> Link copied
        </p>
        <p className="text-xs text-muted-foreground">
          Paste it into {AI_ASSISTANT_NAMES} — or any AI you use. Read-and-draft access, expires in 7 days.
        </p>
        <button
          type="button"
          className="text-xs font-medium text-ct-navy underline"
          onClick={() => setDialogOpen(true)}
          data-testid="awl-compact-change"
        >
          Change access or expiry
        </button>
        <AiWorkLinkDialog open={dialogOpen} onOpenChange={setDialogOpen} mode="project" project={project} client={awl} />
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!project || phase === "minting"}
        title={project ? undefined : "Select a project first"}
        onClick={() => void copyOneClick()}
        data-testid="awl-compact-trigger"
      >
        <Link2 className="size-3.5" aria-hidden="true" />
        {phase === "minting" ? "Copying…" : triggerLabel}
      </Button>
      {phase === "error" && (
        <p className="mt-1 text-xs text-destructive" role="alert" data-testid="awl-compact-error">
          {error}{" "}
          <button type="button" className="underline" onClick={() => setDialogOpen(true)} data-testid="awl-compact-change">
            Change access or expiry
          </button>
        </p>
      )}
      <AiWorkLinkDialog open={dialogOpen} onOpenChange={setDialogOpen} mode="project" project={project} client={awl} />
    </div>
  );
}
