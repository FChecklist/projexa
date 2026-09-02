"use client";

// R67 lane D22 (items D-58 and D-63) -- the one Export/Share control.
//
// WHAT IT REPLACES: an icon-only download glyph that only said "PDF" on hover,
// and a separate button reading "Create Share Link & Send via WhatsApp" that
// buried a real, already-working share mechanism inside a sentence. Two
// controls, two vocabularies, one job. R-187 asked for "Export PDF" plus a
// Share menu; R-203 asked for the same three actions spelled out as words in
// the object header. Both are this component, in its two layouts, so the WPR
// (C06-13) inherits the behaviour instead of copying the markup.
//
// HONEST ABOUT THE BACKEND RULE: createMeetingShareLink() refuses anything but
// a published meeting (409, "Only published meetings can be shared"). The
// share controls are therefore disabled WITH THAT REASON on a draft, rather
// than being clickable and failing -- the disabled-with-reason convention
// C-11 named as this app's good pattern.
//
// POPUP BLOCKERS: window.open() from an async callback is blocked by default
// in several browsers. When it is, the link is copied to the clipboard and the
// caller is handed a message to put in its footer -- the share never silently
// does nothing.
import { useState } from "react";
import { Download, Link2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type ShareLinkResult = { shareUrl: string; whatsappHref: string };

export type ShareSheetProps = {
  /** Relay route that streams the real, server-rendered PDF. */
  pdfHref: string;
  /** Creates a share link (or returns an existing one). Rejects with the backend's own message. */
  createShareLink: () => Promise<ShareLinkResult>;
  /**
   * A share link already known to the caller, so the WhatsApp control can be a
   * real anchor with a real href before anything is clicked.
   */
  shareUrl?: string | null;
  /** Put ahead of the link in the WhatsApp payload, e.g. "MoM - Weekly Site Coordination - 28 Aug 2026 - 4 actions". */
  whatsappSummary?: string;
  /** "words" = three separate word buttons for an object header; "menu" = Export PDF + a Share menu, for list rows. */
  variant?: "words" | "menu";
  /** Non-null disables both share controls and is shown as the reason. */
  shareDisabledReason?: string | null;
  /** Where the caller surfaces the outcome -- the footer message area on an object screen. */
  onMessage?: (message: { level: "success" | "info" | "error"; text: string }) => void;
  size?: "sm" | "default";
};

/** Pure: the wa.me href for a share link, with the one-line summary ahead of it. */
export function whatsappHrefFor(shareUrl: string, summary?: string): string {
  const text = summary ? `${summary}\n${shareUrl}` : shareUrl;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function ShareSheet({
  pdfHref,
  createShareLink,
  shareUrl,
  whatsappSummary,
  variant = "words",
  shareDisabledReason = null,
  onMessage,
  size = "sm",
}: ShareSheetProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(shareUrl ?? null);
  const [busy, setBusy] = useState(false);

  const known = resolvedUrl ?? shareUrl ?? null;
  const waHref = known ? whatsappHrefFor(known, whatsappSummary) : undefined;
  const disabled = !!shareDisabledReason || busy;

  async function resolve(): Promise<string | null> {
    if (known) return known;
    setBusy(true);
    try {
      const link = await createShareLink();
      setResolvedUrl(link.shareUrl);
      return link.shareUrl;
    } catch (err) {
      onMessage?.({ level: "error", text: err instanceof Error ? err.message : "Couldn't create a share link" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function shareOnWhatsApp() {
    const url = await resolve();
    if (!url) return;
    const opened = window.open(whatsappHrefFor(url, whatsappSummary), "_blank", "noopener,noreferrer");
    if (opened) return;
    const copied = await copyToClipboard(url);
    onMessage?.({
      level: copied ? "info" : "error",
      text: copied
        ? `WhatsApp was blocked by the browser. The share link is on your clipboard: ${url}`
        : `WhatsApp was blocked by the browser. Copy this share link: ${url}`,
    });
  }

  async function copyShareLink() {
    const url = await resolve();
    if (!url) return;
    const copied = await copyToClipboard(url);
    onMessage?.({
      level: copied ? "success" : "error",
      text: copied ? "Share link copied to your clipboard" : `Couldn't copy automatically. The share link is ${url}`,
    });
  }

  const exportPdf = (
    <Button variant="ghost" size={size} asChild>
      <a href={pdfHref} target="_blank" rel="noopener noreferrer">
        <Download className="size-3.5" aria-hidden="true" /> Export PDF
      </a>
    </Button>
  );

  if (variant === "menu") {
    return (
      <span className="inline-flex items-center gap-1">
        {exportPdf}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size={size} disabled={disabled} title={shareDisabledReason ?? undefined}>
              Share
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void copyShareLink()}>Copy link</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void shareOnWhatsApp()}>Send via WhatsApp</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {shareDisabledReason && <span className="text-[11.5px] text-px-muted">({shareDisabledReason})</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {exportPdf}
      {/* A real anchor once the link is known, so "share" is an ordinary link
          the browser can open, long-press or copy -- not a script-only button. */}
      {waHref && !disabled ? (
        <Button variant="ghost" size={size} asChild>
          <a href={waHref} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); void shareOnWhatsApp(); }}>
            <Send className="size-3.5" aria-hidden="true" /> Share on WhatsApp
          </a>
        </Button>
      ) : (
        <Button variant="ghost" size={size} disabled={disabled} title={shareDisabledReason ?? undefined} onClick={() => void shareOnWhatsApp()}>
          <Send className="size-3.5" aria-hidden="true" /> Share on WhatsApp
        </Button>
      )}
      <Button variant="ghost" size={size} disabled={disabled} title={shareDisabledReason ?? undefined} onClick={() => void copyShareLink()}>
        <Link2 className="size-3.5" aria-hidden="true" /> Share link
      </Button>
      {shareDisabledReason && <span className="text-[11.5px] text-px-muted">({shareDisabledReason})</span>}
    </span>
  );
}
