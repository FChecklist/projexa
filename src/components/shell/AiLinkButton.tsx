"use client";

// WO-PROJEXA-AI-LINK-001: the persistent UI entry point for the AI Link --
// "give me a link I can paste into any AI, that carries no authority by
// itself." Lives in TopRail's alerts slot alongside NotificationBell (see
// M24Shell.tsx), same pattern that component already established: a small
// icon trigger, a dropdown panel, its own fetch on open rather than a new
// field on the shell bootstrap.
import { useState } from "react";
import { Bot, Copy, RefreshCw, Check, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type LinkState = { url: string; createdAt: string } | null;

async function postAiLink(action: "create" | "rotate" | "revoke"): Promise<LinkState> {
  const res = await fetch("/api/ai-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.link ?? null;
}

export function AiLinkButton() {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<LinkState>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !link) {
      setLoading(true);
      try {
        const res = await fetch("/api/ai-link");
        const body = res.ok ? await res.json() : null;
        setLink(body?.link ?? null);
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleCreate() {
    setLoading(true);
    try {
      setLink(await postAiLink("create"));
    } finally {
      setLoading(false);
    }
  }

  async function handleRotate() {
    setLoading(true);
    try {
      setLink(await postAiLink("rotate"));
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    setLoading(true);
    try {
      await postAiLink("revoke");
      setLink(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Connect your AI" title="Connect your AI">
          <Bot className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3">
        <DropdownMenuLabel className="px-0 text-sm font-semibold">Connect your AI</DropdownMenuLabel>
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
          A link you paste into any AI assistant. It carries no authority by itself -- nothing changes
          in your organization until you review and approve what the AI proposes, back in PROJEXA.
        </p>
        <DropdownMenuSeparator />
        <div className="pt-2">
          {loading && !link && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!loading && !link && (
            <Button size="sm" className="w-full" onClick={handleCreate} disabled={loading}>
              Get my link
            </Button>
          )}
          {link && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <code className="flex-1 truncate text-[11px]">{link.url}</code>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopy} aria-label="Copy link">
                  {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={handleRotate} disabled={loading}>
                  <RefreshCw className="h-3.5 w-3.5" /> Rotate
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={handleRevoke} disabled={loading}>
                  <Ban className="h-3.5 w-3.5" /> Revoke
                </Button>
              </div>
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
