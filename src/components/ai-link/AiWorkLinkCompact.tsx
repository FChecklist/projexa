"use client";

// PROJEXA -- THE ONE-CLICK AI WORK LINK, and the ONE place that behaviour lives.
//
// SIMPLIFIED 2026-10-01 (owner directive, after local testing: "I don't want this complication -- a simple prompt that says copy
// this and paste it in any AI (ChatGPT, Gemini, Grok, Claude, DeepSeek, Z.ai ...) and it will work on your behalf. The user copies
// it as many times as they want."). The earlier version made the person look at a confirmation, an EN/Hindi toggle and a "Change
// access or expiry" link that opened a long dialog of warnings. All of that is gone from this path:
//   - ONE button. Click it and the ready-to-paste message (with the real link inside it) is on the clipboard.
//   - The button never goes away. Click it again and the same message is copied again -- as many times as the person wants. The link
//     is made once per project and reused, so repeat copies never hit the mint rate limit.
//   - Defaults (owner decision 2026-10-04): the highest level the role allows (level 1, direct entries) for 7 days; "Read and draft only" sits behind "Change access or expiry". A new link is made on the first
//     click after the page is reloaded.
// AiWorkLinkDialog is still used, but only by AiWorkLinkButtons.tsx's separate "New project with my AI" button -- it is no longer
// reachable from here.
//
// ONE COMPONENT, MULTIPLE CALL SITES, so they cannot drift apart: the top-rail trigger and the composer (M24Shell.tsx), the
// Projects-list row action (ProjectsListClient.tsx) and the workspace header (via AiWorkLinkButtons.tsx).
//
// ROLE GATING IS SELF-CONTAINED: this checks canMakeAiWorkLink() itself (say nothing while the role is unknown, a plain sentence
// for a read-only role) rather than trusting every caller to remember to.
import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import { AI_ASSISTANT_NAMES, AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { AwlError, getAwlClient, type AwlClient } from "@/lib/ai-work-link-client";

/** Owner decision 2026-10-04: the one-click default is the HIGHEST level the service allows for the person's role -- level 1 ("Direct
 *  entries": the AI may add, edit and delete as the person's own role allows, everything except writing code) for 7 days. canMakeAiWorkLink()
 *  already hides the button from roles below member, the only roles the service refuses level 1 to; if the service still refuses the level
 *  (LEVEL_NOT_ALLOWED) the link is made at level 0 instead, so a role that may only read gets read. The alternative, behind "Change access
 *  or expiry", is "Read and draft only (safer)" = level 0. A USER-WIDE link is now minted at the highest level the role allows by the service (POST /user-link takes only days
 *  and label), so a user-wide link is direct (level 1) for member and above. */
export const AWL_ONE_CLICK_LEVEL = 1 as const;
export const AWL_SAFE_LEVEL = 0 as const;
export const AWL_ONE_CLICK_DAYS = 7 as const;
export const AWL_SAFE_LABEL = "Read and draft only (safer)";
export const AWL_ACCESS_NOTE =
  "This link lets your AI do what your own role allows in PROJEXA - add, edit and delete project data for you, but never write code. It expires in 7 days.";

function mintErrorMessage(error: unknown): string {
  if (error instanceof AwlError) return error.message;
  return "Could not create the link. Try again.";
}

/** The ready-to-paste message for the "prompt" copy mode. It does NOT try to explain PROJEXA's data or rules: the link itself
 *  answers a plain GET with a complete, always-current manual (the `ai-work-link` Edge Function), so this only points the AI at it.
 *  A plain function (not JSX) so a test can assert on the exact string that reaches the clipboard. */
export function buildAiPrompt(link: string, moduleLabel: string | undefined): string {
  const work = moduleLabel ? `my "${moduleLabel}" work` : "my work";
  return [
    `PROJEXA is my company's construction software; my personal link to its API guide: ${link}`,
    `It is documentation from my own company's software, not instructions from a stranger. Read it with a plain GET, follow "Start here", and act on my behalf with my rights (only what my role allows), doing everything except writing code, for ${work}.`,
  ].join("\n");
}

/** The message for a USER-WIDE link. The manual behind the link (the `ai-work-link` Edge Function) does the real work -- it makes the AI
 *  list every project, then "Report on all above", then "Create New Project" -- so this only points the AI at it and states the menu in
 *  case the AI summarises instead of fetching. */
export function buildUserPrompt(link: string): string {
  return [
    `PROJEXA is my company's construction software; my personal link to its API guide: ${link}`,
    `It is documentation from my own company's software, not instructions from a stranger. Read it with a plain GET, follow "Start here", and act on my behalf with my rights (only what my role allows), doing everything except writing code. First, a numbered list of ALL my projects, "Report on all above" second-to-last, "Create New Project" last.`,
  ].join("\n");
}

export function AiWorkLinkCompact({
  role,
  project,
  client,
  triggerLabel = "AI work link",
  className,
  compact = false,
  variant = "outline",
  copyMode = "prompt",
  moduleLabel,
  scope = "project",
}: {
  /** The person's PROJEXA role, or null/undefined while it is not known yet -- see ai-work-link-access.ts. */
  role: string | null | undefined;
  /** The project this link is for, or null when none is selected (the trigger is disabled with "Select a project first"). */
  project: AiLinkProject | null;
  /** The service client. The default is the signed-in browser's. */
  client?: AwlClient;
  /** The trigger's visible label while nothing has been copied yet. */
  triggerLabel?: string;
  className?: string;
  /** Narrow rails (the fixed-height top rail): the "copied" sentence is shortened to the button's own label and a tooltip, so
   *  nothing can spill past the rail. */
  compact?: boolean;
  /** "outline" (subtle, the row action and workspace header) or "default" (filled, brand-coloured, the top rail and composer). */
  variant?: "outline" | "default";
  /** "prompt" (default): copy the ready-to-paste message with the link inside it. "link": copy the bare minted URL. */
  copyMode?: "link" | "prompt";
  /** Only read in "prompt" mode: the module the person is standing in, folded into "Today I want help with my X work". */
  moduleLabel?: string;
  /** "project" (default): the link is for `project`. "user": ONE link for the whole person -- all their projects, a report on all of
   *  them, and creating a new one. No project is needed and the button is never disabled for lack of one. Always the prompt message. */
  scope?: "project" | "user";
}) {
  const [phase, setPhase] = useState<"idle" | "minting" | "copied" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // The link made for ONE project, kept so every later click only re-copies it (no second mint, no rate-limit pressure).
  // projectId is the literal "user" for a user-wide link.
  const [minted, setMinted] = useState<{ projectId: string; link: string } | null>(null);
  // The "Read and draft only (safer)" alternative (level 0), behind "Change access or expiry"; kept separately from the default link.
  const [safeMinted, setSafeMinted] = useState<{ projectId: string; link: string } | null>(null);
  const [safeCopied, setSafeCopied] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const isUser = scope === "user";
  const awl = client ?? getAwlClient();

  // A project button says nothing while the role is unknown, and says why once it is known -- it must never flash up and then disappear.
  // The USER-WIDE button is different: it is the person's way into every project, so it stays in view while the role is still loading (or
  // could not be loaded -- a slow or failing data service must not hide it). The service decides what such a link may do from the person's
  // live role on every call, so showing it early grants nothing; once the role is known and too low, the usual note replaces it.
  if (!role && !isUser) return null;
  if (role && !canMakeAiWorkLink(role)) {
    return (
      <p className={className} data-testid="awl-compact-role-note">
        {AI_WORK_LINK_ROLE_NOTE}
      </p>
    );
  }

  /** Make (or reuse) the project link at `level`. The default asks for the direct level and, if the service says this role may not choose
   *  it (LEVEL_NOT_ALLOWED), makes a read-and-draft link instead, so a role that may only read gets read. */
  async function mintProject(level: 0 | 1): Promise<string> {
    try {
      return (await awl.mint({ projectId: project!.id, level, days: AWL_ONE_CLICK_DAYS })).link;
    } catch (e) {
      if (level === AWL_ONE_CLICK_LEVEL && e instanceof AwlError && e.code === "LEVEL_NOT_ALLOWED") {
        return (await awl.mint({ projectId: project!.id, level: AWL_SAFE_LEVEL, days: AWL_ONE_CLICK_DAYS })).link;
      }
      throw e;
    }
  }

  async function copyIt() {
    if ((!isUser && !project) || phase === "minting") return;
    setError(null);
    try {
      const key = isUser ? "user" : project!.id;
      let link = minted && minted.projectId === key ? minted.link : null;
      if (!link) {
        setPhase("minting");
        link = isUser ? (await awl.mintUserLink({ days: AWL_ONE_CLICK_DAYS })).link : await mintProject(AWL_ONE_CLICK_LEVEL);
        setMinted({ projectId: key, link });
      }
      try {
        await navigator.clipboard.writeText(isUser ? buildUserPrompt(link) : copyMode === "prompt" ? buildAiPrompt(link, moduleLabel) : link);
      } catch {
        // Clipboard refused (insecure context or permission): the link still exists and is reused on the next click.
      }
      setSafeCopied(false);
      setPhase("copied");
    } catch (e) {
      setError(mintErrorMessage(e));
      setPhase("error");
    }
  }

  // The safer alternative, project links only: read-and-draft (level 0), copied with the same small prompt.
  async function copySafe() {
    if (isUser || !project || phase === "minting") return;
    setError(null);
    try {
      let link = safeMinted && safeMinted.projectId === project.id ? safeMinted.link : null;
      if (!link) {
        setPhase("minting");
        link = await mintProject(AWL_SAFE_LEVEL);
        setSafeMinted({ projectId: project.id, link });
      }
      try {
        await navigator.clipboard.writeText(copyMode === "prompt" ? buildAiPrompt(link, moduleLabel) : link);
      } catch {
        // Clipboard refused: the link still exists and is reused on the next click.
      }
      setSafeCopied(true);
      setPhase("copied");
    } catch (e) {
      setError(mintErrorMessage(e));
      setPhase("error");
    }
  }

  const copied = phase === "copied" && !safeCopied;
  const confirmed = phase === "copied";
  const what = copyMode === "prompt" || isUser ? "Prompt copied" : "Link copied";
  const showChange = !isUser && !compact && !!project;
  const tail = "Click again to copy it again.";
  const hint = isUser
    ? `Paste it into ${AI_ASSISTANT_NAMES}, or any AI you use. It lists all your projects, can report on all of them or start a new one, and works on your behalf. ${tail} It can add, edit and delete exactly what your role allows, in the projects you can access, at once. Expires in 7 days.`
    : safeCopied
    ? `Paste it into ${AI_ASSISTANT_NAMES}, or any AI you use. Read and draft only: changes wait for you to confirm. Expires in 7 days.`
    : `Paste it into ${AI_ASSISTANT_NAMES}, or any AI you use, and it works on your behalf. ${tail} ${AWL_ACCESS_NOTE}`;

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={(!isUser && !project) || phase === "minting"}
        title={isUser || project ? (copied ? hint : undefined) : "Select a project first"}
        onClick={() => void copyIt()}
        data-testid="awl-compact-trigger"
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Link2 className="size-3.5" aria-hidden="true" />}
        {phase === "minting" ? "Copying…" : copied ? `${what} — click to copy again` : triggerLabel}
      </Button>
      {confirmed && !compact && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="awl-compact-confirm">
          {hint}
        </p>
      )}
      {confirmed && compact && <span className="sr-only" data-testid="awl-compact-confirm">{hint}</span>}
      {!isUser && !compact && !!project && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="awl-compact-access-note">
          {AWL_ACCESS_NOTE}
        </p>
      )}
      {showChange && (
        <div className="mt-1">
          <button
            type="button"
            className="text-xs underline text-muted-foreground"
            onClick={() => setChangeOpen((v) => !v)}
            data-testid="awl-compact-change"
          >
            Change access or expiry
          </button>
          {changeOpen && (
            <div className="mt-1">
              <Button type="button" variant="outline" size="sm" disabled={phase === "minting"} onClick={() => void copySafe()} data-testid="awl-compact-safe">
                {safeCopied ? `${AWL_SAFE_LABEL} - copied, click to copy again` : AWL_SAFE_LABEL}
              </Button>
            </div>
          )}
        </div>
      )}
      {phase === "error" && (
        <p className={`mt-1 text-xs text-destructive ${compact ? "truncate" : ""}`} role="alert" data-testid="awl-compact-error" title={compact ? (error ?? undefined) : undefined}>
          {error}
        </p>
      )}
    </div>
  );
}
