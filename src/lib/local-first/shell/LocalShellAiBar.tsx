"use client";

// The local (laptop) shell's one AI control: "+ Connect to AI" (owner order 2026-10-11). The copy-this-prompt button and the Connectors button that
// used to sit here are gone: an outside chat website often cannot open the link, so they "could not work properly"; the same thing now lives under
// "Advanced" inside the Connect panel. The panel (ConnectYourAiPanel) holds everything: connect an AI for me, share it with teammates, and (owner/admin)
// the organisation's AI.
//
// OFFLINE. Connecting an AI is a call to PROJEXA and to the AI company, so it needs internet; the button says so instead of failing. Everything else
// in the shell (every screen, form and report from the laptop's own copy) works offline exactly as before and never needs an AI.
import ConnectYourAiPanel from "@/components/ai-link/ConnectYourAiPanel";
import type { AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import type { AwlClient } from "@/lib/ai-work-link-client";
import { AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";

export const AI_BAR_CAPTION = "Connect ChatGPT, Claude, Gemini and more";
export const AI_BAR_OFFLINE_CAPTION = "Needs internet to connect. Everything else works offline.";
const CAP = "max-w-[12rem] text-center text-xs font-medium leading-snug text-[#7C3AED]";

// `project`, `client` and `fetchText` stay on the type so the shell's call site and older tests keep compiling; the panel needs none of them.
export function LocalShellAiBar({ role, online }: { role: string | null | undefined; project?: AiLinkProject | null; online: boolean; client?: AwlClient; fetchText?: unknown }) {
  // A read-only role (a client viewer) cannot connect an AI: a plain sentence instead of a button that would be refused.
  if (role && !canMakeAiWorkLink(role)) {
    return <p className="text-xs text-px-muted" data-testid="local-shell-ai-role-note">{AI_WORK_LINK_ROLE_NOTE}</p>;
  }
  return (
    <div className="flex flex-col items-center gap-1" data-testid="local-shell-ai-bar" data-online={online ? "1" : "0"}>
      <ConnectYourAiPanel role={role} prominent />
      <span className={CAP} data-testid="local-shell-ai-caption">{online ? AI_BAR_CAPTION : AI_BAR_OFFLINE_CAPTION}</span>
    </div>
  );
}
