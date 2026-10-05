"use client";

// The shell header's AI controls, needing NO project: "Copy AI prompt" (the person's own small prompt, one user-wide link) and
// "Connectors" (the same link turned into the MCP / OpenAPI / Swagger addresses AI apps ask for). Both used to be hidden whenever the
// person had no project on this laptop, which is exactly when they most need their AI (it can list their projects and create one).
// Making a link needs the server, so offline both are shown disabled with the reason.
import { useState } from "react";
import { AiWorkLinkCompact } from "@/components/ai-link/AiWorkLinkCompact";
import { AiWorkLinkCardButton } from "@/components/ai-link/AiWorkLinkCardButton";
import { AiWorkLinkConnect } from "@/components/ai-link/AiWorkLinkConnect";
import type { AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import { AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { AwlError, getAwlClient, type AwlClient } from "@/lib/ai-work-link-client";
import { LOCAL_SHELL_AI_LINK_OFFLINE_NOTE } from "./LocalShellAiLink";

export const AI_BAR_PROMPT_CAPTION = "Paste it into any AI to work for you";
export const AI_BAR_CONNECT_CAPTION = "Connect PROJEXA to your AI app";
const CAP = "max-w-[11rem] text-center text-xs font-medium leading-snug text-[#7C3AED]";

const BTN = "inline-flex items-center rounded-md border-2 border-[#2DD4BF] bg-[#14C8B4] px-3 py-1 text-sm font-semibold text-white hover:bg-[#2DD4BF] disabled:opacity-60";
const PROMPT_BTN = "[&_button]:border-2 [&_button]:border-[#FDBA74] [&_button]:bg-[#FF8A1F] [&_button]:font-semibold [&_button]:text-white [&_button:hover]:bg-[#FF9F40]";

export function LocalShellAiBar({ role, project, online, client, fetchText }: { role: string | null | undefined; project: AiLinkProject | null; online: boolean; client?: AwlClient; fetchText?: (link: string, path: string) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!online) {
    return (
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2" data-testid="local-shell-ai-bar" data-online="0">
        <div className="flex flex-col items-center gap-1">
          <button type="button" disabled title={LOCAL_SHELL_AI_LINK_OFFLINE_NOTE} className={BTN} data-testid="local-shell-ai-link-offline-button">Copy AI prompt</button>
          <span className={CAP}>{AI_BAR_PROMPT_CAPTION}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button type="button" disabled title={LOCAL_SHELL_AI_LINK_OFFLINE_NOTE} className={BTN} data-testid="local-shell-connectors-offline">Connectors</button>
          <span className={CAP}>{AI_BAR_CONNECT_CAPTION}</span>
        </div>
        <span className="sr-only" data-testid="local-shell-ai-link-offline-note">{LOCAL_SHELL_AI_LINK_OFFLINE_NOTE}</span>
      </div>
    );
  }
  if (role && !canMakeAiWorkLink(role)) {
    return <p className="text-xs text-px-muted" data-testid="local-shell-ai-role-note">{AI_WORK_LINK_ROLE_NOTE}</p>;
  }

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (link || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await (client ?? getAwlClient()).mintUserLink({ days: 7 });
      setLink(made.link);
    } catch (e) {
      setError(e instanceof AwlError ? e.message : "Could not create the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex flex-wrap items-start gap-x-4 gap-y-2" data-testid="local-shell-ai-bar" data-online="1">
      <div className={`flex flex-col items-center gap-1 ${PROMPT_BTN}`}>
        <AiWorkLinkCompact role={role} project={null} client={client} scope="user" compact variant="default" triggerLabel="Copy AI prompt" />
        <span className={CAP} data-testid="local-shell-ai-caption">{AI_BAR_PROMPT_CAPTION}</span>
        {project ? <AiWorkLinkCardButton role={role} project={project} client={client} fetchText={fetchText} compact /> : null}
      </div>
      <div className="flex flex-col items-center gap-1">
        <button type="button" className={BTN} aria-expanded={open} onClick={() => void toggle()} data-testid="local-shell-connectors">Connectors</button>
        <span className={CAP} data-testid="local-shell-connect-caption">{AI_BAR_CONNECT_CAPTION}</span>
      </div>
      {open ? (
        <div className="fixed inset-x-2 z-20 mt-2 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-[26rem] sm:max-w-[90vw] rounded-xl border-2 border-[#2DD4BF] bg-[#F0FFFC] p-3 text-sm text-px-ink shadow-lg" data-testid="local-shell-connectors-panel">
          <p className="font-medium">Connect PROJEXA to your AI</p>
          {busy ? <p className="mt-2 text-xs text-px-muted">Making your link…</p> : null}
          {error ? <p className="mt-2 text-xs text-red-700" role="alert">{error}</p> : null}
          {link ? <AiWorkLinkConnect link={link} /> : null}
        </div>
      ) : null}
    </div>
  );
}
