"use client";

// "Connect your AI" -- the plain-words guide to the three ways an outside AI (ChatGPT, Claude, Gemini, DeepSeek, Z.ai, Grok ...)
// can work in PROJEXA on a person's behalf, with the one button that makes the access link. It sits in the chat box of the
// Traditional View, next to the one-click "AI prompt" chip. The link itself is made, copied and shown by AiWorkLinkCompact
// (its "Connect" rows give the MCP address, the API/OpenAPI and Swagger addresses with a copy button each); this file only
// explains how to use them. It makes no network call of its own.
import { useState } from "react";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AiWorkLinkCompact } from "@/components/ai-link/AiWorkLinkCompact";

export const CONNECT_YOUR_AI_STEPS: { id: "prompt" | "mcp" | "api"; title: string; steps: string[] }[] = [
  {
    id: "prompt",
    title: "1. Access link and prompt (works in any AI chat)",
    steps: [
      "Press the orange button below. PROJEXA makes your access link and copies a ready prompt.",
      "Open your AI (ChatGPT, Claude, Gemini, DeepSeek, Z.ai, Grok) and paste.",
      "Your AI now works in PROJEXA for you, as far as your own role allows. It never writes code.",
    ],
  },
  {
    id: "mcp",
    title: "2. MCP connector (for AIs that have Connectors)",
    steps: [
      "Make the link (button below), then press Connect under it and copy the MCP address.",
      "In your AI: Settings, Connectors, Add custom connector. Paste the address.",
      "Allow it when your AI asks. Done.",
    ],
  },
  {
    id: "api",
    title: "3. API (custom GPT, Gemini, Zapier, n8n)",
    steps: [
      "Make the link, press Connect, and copy the OpenAPI address (or Swagger if your tool asks for it).",
      "In your tool: add an Action or API, import from that address.",
      "The link is the key: no other password is needed.",
    ],
  },
];

export const CONNECT_YOUR_AI_SAFETY =
  "Your link is your password. Never share it or post it in a group. Making a new one stops the old one. Some free AI plans do not allow connectors; then use the prompt.";

/** The guide itself (every way, the make-link button, the safety line). Exported so it can be tested without the dialog's portal. */
export function ConnectGuideBody({ role }: { role: string | null | undefined }) {
  return (
    <div className="space-y-4 text-[13px]">
            {CONNECT_YOUR_AI_STEPS.map((s) => (
              <section key={s.id} aria-label={s.title}>
                <h3 className="font-semibold" style={{ color: "var(--color-ct-navy)" }}>{s.title}</h3>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5" style={{ color: "var(--color-ct-slate)" }}>
                  {s.steps.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ol>
              </section>
            ))}
            <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-ct-border2)", background: "var(--color-ct-cloud)" }}>
              <AiWorkLinkCompact role={role} project={null} scope="user" triggerLabel="Make my access link and copy the AI prompt" variant="default" />
            </div>
            <p className="text-[12px]" style={{ color: "var(--color-ct-slate)" }}>{CONNECT_YOUR_AI_SAFETY}</p>
          </div>
  );
}

export default function ConnectYourAi({ role }: { role: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="text-[12px]" onClick={() => setOpen(true)} data-testid="connect-your-ai-open">
        <Plug className="size-3.5" aria-hidden /> Connect your AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" data-testid="connect-your-ai-dialog">
          <DialogHeader>
            <DialogTitle>Connect your AI to PROJEXA</DialogTitle>
            <DialogDescription>Use the AI you already pay for. It does the work for you. Pick one way.</DialogDescription>
          </DialogHeader>
          <ConnectGuideBody role={role} />
        </DialogContent>
      </Dialog>
    </>
  );
}
