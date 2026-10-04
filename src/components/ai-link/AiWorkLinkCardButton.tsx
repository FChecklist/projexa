"use client";

// PROJEXA -- THE "NO BROWSING" AI PROMPT (Audit 37). The one-click prompt (AiWorkLinkCompact.tsx) hands an AI a web address and
// expects it to open it. Chat AIs without live web access (ChatGPT, Gemini, DeepSeek, z.ai in a plain chat) cannot, so they never
// read the guide. This control builds ONE self-contained text instead: the paste card (GET <link>/card.md: rules, the functions the AI
// may propose, and the paste-back "projexa-proposal" block format) plus a snapshot of the selected project's data (GET
// <link>/card-data.md, money already hidden by role). Everything the AI needs is in the text, so nothing has to be opened.
//
// THE TOKEN STAYS OUT. The card and the data hold no address and no token (backend contract, manual.ts renderCard/renderCardData). The
// link is used only to fetch them; it is never part of the copied text.
//
// A PROJECT LINK, NOT THE USER-WIDE ONE: card-data.md needs a project (a user-wide link answers it 400), so this always mints/reuses a
// link for the selected project (level 0, 7 days -- the same safe defaults as the one-click path) and keeps it for repeat clicks.
import { useState } from "react";
import { Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import { AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { AWL_CARD_DATA_KINDS, AwlError, fetchLinkText, getAwlClient, type AwlClient } from "@/lib/ai-work-link-client";
import { AWL_ONE_CLICK_DAYS, AWL_ONE_CLICK_LEVEL } from "@/components/ai-link/AiWorkLinkCompact";

/** The most data text pasted with the card. The backend allows a snapshot of up to 100,000 bytes, far more than a chat box takes
 *  comfortably, so it is cut at a line boundary here with a plain note. */
export const AWL_CARD_DATA_MAX_CHARS = 40000;

export const AWL_CARD_LABEL = "AI prompt - for AIs that cannot open links";

const INSTRUCTION =
  "Please work only from the text below, which is everything I can give you (you cannot open links); when you want to change something, reply with the projexa-proposal block described in the card and I will paste it into PROJEXA to confirm.";

/** Cut `text` to at most `max` characters at a line boundary. Returns whether it was cut. */
function trimToLines(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const nl = head.lastIndexOf("\n");
  return { text: nl > 0 ? head.slice(0, nl) : head, cut: true };
}

/** The single text that reaches the clipboard. Plain function so a test can assert on it. `data` is null when the snapshot could not be
 *  fetched. Contains neither the link nor its token. */
export function buildCardPrompt(card: string, data: string | null, projectName: string | undefined): string {
  const parts = [INSTRUCTION, "", card.trim(), ""];
  if (data === null) {
    parts.push("The project data could not be loaded just now. Ask me to paste whatever you need from PROJEXA.");
  } else {
    const t = trimToLines(data.trim(), AWL_CARD_DATA_MAX_CHARS);
    parts.push(projectName ? `## Project data: ${projectName}` : "## Project data", "", t.text);
    if (t.cut) parts.push("", "Note: the data above was shortened to fit. Ask me for anything that is missing.");
  }
  return parts.join("\n");
}

type FetchText = (link: string, path: string) => Promise<string>;

export function AiWorkLinkCardButton({
  role,
  project,
  client,
  fetchText,
  triggerLabel = AWL_CARD_LABEL,
  className,
  compact = false,
  variant = "outline",
}: {
  role: string | null | undefined;
  /** The selected project; the control is disabled with "Select a project first" when none. */
  project: AiLinkProject | null;
  client?: AwlClient;
  /** Fetches a text page under the link. The default is the browser's fetch; tests pass a fake. */
  fetchText?: FetchText;
  triggerLabel?: string;
  className?: string;
  compact?: boolean;
  variant?: "outline" | "default";
}) {
  const [phase, setPhase] = useState<"idle" | "working" | "copied" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dataMissing, setDataMissing] = useState(false);
  const [minted, setMinted] = useState<{ projectId: string; link: string } | null>(null);
  const awl = client ?? getAwlClient();
  const get: FetchText = fetchText ?? ((link, path) => fetchLinkText(link, path));

  if (!role) return null;
  if (!canMakeAiWorkLink(role)) {
    return (
      <p className={className} data-testid="awl-card-role-note">
        {AI_WORK_LINK_ROLE_NOTE}
      </p>
    );
  }

  async function copyIt() {
    if (!project || phase === "working") return;
    setError(null);
    setDataMissing(false);
    setPhase("working");
    try {
      let link = minted && minted.projectId === project.id ? minted.link : null;
      if (!link) {
        const made = await awl.mint({ projectId: project.id, level: AWL_ONE_CLICK_LEVEL, days: AWL_ONE_CLICK_DAYS });
        link = made.link;
        setMinted({ projectId: project.id, link });
      }
      const card = await get(link, "/card.md");
      let data: string | null = null;
      try {
        data = await get(link, `/card-data.md?kinds=${AWL_CARD_DATA_KINDS}`);
      } catch {
        data = null;
      }
      try {
        await navigator.clipboard.writeText(buildCardPrompt(card, data, project.name));
      } catch {
        // Clipboard refused (insecure context or permission): the link is kept and reused on the next click.
      }
      setDataMissing(data === null);
      setPhase("copied");
    } catch (e) {
      setError(e instanceof AwlError ? e.message : "Could not prepare the text. Try again.");
      setPhase("error");
    }
  }

  const copied = phase === "copied";
  const hint = dataMissing
    ? "Copied the instructions without the project data, which could not be loaded just now. Paste it into any AI, then give it the details it asks for. Click again to try once more."
    : "Paste it into any AI, including ones that cannot open links. It holds the instructions and this project's data, and the AI replies with changes for you to confirm. Click again to copy it again.";

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={!project || phase === "working"}
        title={project ? (copied ? hint : undefined) : "Select a project first"}
        onClick={() => void copyIt()}
        data-testid="awl-card-trigger"
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <FileText className="size-3.5" aria-hidden="true" />}
        {phase === "working" ? "Copying..." : copied ? "Text copied - click to copy again" : triggerLabel}
      </Button>
      {copied && !compact && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="awl-card-confirm">
          {hint}
        </p>
      )}
      {copied && compact && <span className="sr-only" data-testid="awl-card-confirm">{hint}</span>}
      {phase === "error" && (
        <p className={`mt-1 text-xs text-destructive ${compact ? "truncate" : ""}`} role="alert" data-testid="awl-card-error" title={compact ? (error ?? undefined) : undefined}>
          {error}
        </p>
      )}
    </div>
  );
}
