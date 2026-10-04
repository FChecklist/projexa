"use client";

// The AI work link control for the offline-capable local shell's header. The normal (app) shell has it in its chat rail; this shell is
// what opens on an installed laptop copy, so without this the person could not copy their link to paste into any AI. It REUSES the
// one-click AiWorkLinkCompact (mint with safe defaults, copy to clipboard) rather than re-implementing it. Creating a link needs the
// server, so when the laptop is offline the control is shown disabled with a calm reason instead of failing.
import { FileText, Link2 } from "lucide-react";
import { AiWorkLinkCompact } from "@/components/ai-link/AiWorkLinkCompact";
import { AiWorkLinkCardButton } from "@/components/ai-link/AiWorkLinkCardButton";
import type { AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import type { AwlClient } from "@/lib/ai-work-link-client";

export const LOCAL_SHELL_AI_LINK_OFFLINE_NOTE = "The AI work link needs the internet to be created. It will be available when you are connected.";

export function LocalShellAiLink({ role, project, online, client, fetchText }: { role: string | null | undefined; project: AiLinkProject | null; online: boolean; client?: AwlClient; fetchText?: (link: string, path: string) => Promise<string> }) {
  if (!project) return null;
  if (!online) {
    return (
      <div data-testid="local-shell-ai-link" data-online="0">
        <button
          type="button"
          disabled
          title={LOCAL_SHELL_AI_LINK_OFFLINE_NOTE}
          aria-describedby="local-shell-ai-link-offline"
          data-testid="local-shell-ai-link-offline-button"
          className="inline-flex items-center gap-1 rounded-md border border-black/10 px-2 py-1 text-xs opacity-60"
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          AI work link
        </button>
        <button
          type="button"
          disabled
          title={LOCAL_SHELL_AI_LINK_OFFLINE_NOTE}
          aria-describedby="local-shell-ai-link-offline"
          data-testid="local-shell-ai-card-offline-button"
          className="inline-flex items-center gap-1 rounded-md border border-black/10 px-2 py-1 text-xs opacity-60"
        >
          <FileText className="size-3.5" aria-hidden="true" />
          AI prompt - for AIs that cannot open links
        </button>
        <span id="local-shell-ai-link-offline" className="sr-only" data-testid="local-shell-ai-link-offline-note">{LOCAL_SHELL_AI_LINK_OFFLINE_NOTE}</span>
      </div>
    );
  }
  return (
    <div data-testid="local-shell-ai-link" data-online="1">
      <AiWorkLinkCompact role={role} project={project} client={client} compact triggerLabel="AI prompt - paste in any AI" />
      <AiWorkLinkCardButton role={role} project={project} client={client} fetchText={fetchText} compact />
    </div>
  );
}
