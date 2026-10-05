"use client";

// PROJEXA -- THE "CONNECT" PANEL of the AI work link. Shown after the person has made a link (the client holds it once, in
// AiWorkLinkCompact's state; nothing here stores it anywhere, sends it anywhere or logs it). It turns the one link into the three
// things AI apps ask for, each with a one-tap copy button:
//   1. MCP connector     = the link itself
//   2. OpenAPI           = <link>/openapi.json   (custom GPT / Gemini / Zapier / n8n)
//   3. Swagger 2.0       = <link>/swagger.json
//   4. the small prompt  = for any chat that has no connectors
// Plain words only. No network call is made here: copying only writes to the clipboard.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildUserPrompt } from "@/components/ai-link/AiWorkLinkCompact";

export const AWL_CONNECT_FREE_PLAN_NOTE = "Some free AI plans do not allow connectors; then paste the prompt instead.";
export const AWL_CONNECT_PASSWORD_WARNING =
  "Your link is your password. Never share it, never put it in a team or shared workspace, never forward the email it came in. A new link replaces the old one, so update the connector if you make a new one.";

/** The three addresses derived from one link. Plain function so a test can assert on the exact suffixes. */
export function connectUrls(link: string): { mcp: string; openapi: string; swagger: string } {
  const base = link.replace(/\/+$/, "");
  return { mcp: link, openapi: `${base}/openapi.json`, swagger: `${base}/swagger.json` };
}

type RowKey = "mcp" | "openapi" | "swagger" | "prompt";

export function AiWorkLinkConnect({ link, className }: { link: string; className?: string }) {
  const [copiedKey, setCopiedKey] = useState<RowKey | null>(null);
  const urls = connectUrls(link);

  async function copy(key: RowKey, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard refused (insecure context or permission): nothing else to do; the button just does not confirm.
      return;
    }
    setCopiedKey(key);
  }

  const rows: Array<{ key: RowKey; title: string; value: string; lines: string[] }> = [
    {
      key: "mcp",
      title: "MCP connector",
      value: urls.mcp,
      lines: [
        "Claude: Settings > Connectors > Add custom connector, paste this, name it PROJEXA. ChatGPT: Settings > Connectors > Developer mode > add an MCP server with this link.",
        "Cursor, VS Code, Claude Code, Gemini CLI: add an MCP server and use this link as its URL.",
      ],
    },
    {
      key: "openapi",
      title: "OpenAPI (custom GPT / Gemini / Zapier / n8n)",
      value: urls.openapi,
      lines: [
        "ChatGPT: Create a GPT > Actions > import from URL, paste this.",
        "Gemini (Gem or agent builder), Zapier and n8n: import this address as the API description.",
      ],
    },
    {
      key: "swagger",
      title: "Swagger 2.0",
      value: urls.swagger,
      lines: ["For tools that only understand the older Swagger format.", "Import it from this address the same way as OpenAPI."],
    },
    {
      key: "prompt",
      title: "Small prompt",
      value: buildUserPrompt(link),
      lines: ["DeepSeek, z.ai, Grok and any other chat: paste this prompt into the chat.", "Use it too when your AI has no connectors."],
    },
  ];

  return (
    <div className={className} data-testid="awl-connect">
      <ul className="mt-2 space-y-3">
        {rows.map((r) => (
          <li key={r.key} data-testid={`awl-connect-row-${r.key}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{r.title}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void copy(r.key, r.value)} data-testid={`awl-connect-copy-${r.key}`}>
                {copiedKey === r.key ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                {copiedKey === r.key ? "Copied" : "Copy"}
              </Button>
            </div>
            {r.key !== "prompt" && (
              <code className="mt-1 block break-all text-xs text-muted-foreground" data-testid={`awl-connect-value-${r.key}`}>
                {r.value}
              </code>
            )}
            {r.lines.map((l) => (
              <p key={l} className="mt-1 text-xs text-muted-foreground">
                {l}
              </p>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground" data-testid="awl-connect-free-note">
        {AWL_CONNECT_FREE_PLAN_NOTE}
      </p>
      <p className="mt-2 text-xs font-bold" data-testid="awl-connect-warning">
        {AWL_CONNECT_PASSWORD_WARNING}
      </p>
    </div>
  );
}
