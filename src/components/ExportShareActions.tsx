"use client";

// R67 E-18 (R-178). ONE Export / Share control, for every report screen.
//
// WHAT IT REPLACES. Six screens each invented their own answer to the same two
// questions. The Work Progress Report grew five separate header buttons; the
// Cost Variance and Permits screens hard-coded "Export (Not yet available)" --
// a stub, not a data condition; and the WPR's PDF had existed end to end since
// #1314 (generateWorkProgressReportPdf, its VERIDIAN route, and the projexa
// relay) with no button anywhere calling it.
//
// TWO WORD-BUTTONS WITH MENUS, not eight buttons in a row: "Export" and
// "Share" are the two things a reader wants to do with a finished report, and
// the format is a detail inside each. A header that lists PDF, XLSX, CSV,
// WhatsApp and Copy link side by side makes the reader read five words to find
// one.
//
// PROJEXA MUST NOT GAIN A PDF OR AN XLSX LIBRARY. Every binary format is an
// href into a relay route; VERIDIAN builds the bytes. CSV may be built in the
// browser from the rows on screen (that is a trust feature -- the file is the
// table), which is why `onCsv` exists beside `csvHref`.
//
// DISABLED CARRIES ITS REASON, IN WORDS, BESIDE THE BUTTON. Never a greyed
// control with nothing to read, and never a tooltip as the only carrier: a
// tooltip cannot be read on a phone, on a printout, or by someone who does not
// know to hover.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText, Link2, MessageCircle, Share2 } from "lucide-react";

export type ExportShareActionsProps = {
  /** False disables Export and shows `exportReason` beside it. */
  canExport: boolean;
  /** Why Export cannot be pressed, in words. Required whenever canExport is false. */
  exportReason?: string | null;
  /** Names the document in the WhatsApp message and the copied-link toast. */
  title: string;
  /** Relay URLs. A format with no href simply is not offered -- never offered and then broken. */
  pdfHref?: string | null;
  xlsxHref?: string | null;
  csvHref?: string | null;
  /** A CSV built in the browser from the rows on screen. Wins over csvHref when both are given. */
  onCsv?: (() => void) | null;
  /**
   * Mints (or returns) the shareable link. Returning null means the link could
   * not be made, and the control says so rather than opening an empty share.
   * Absent entirely means this screen has no share link, and the Share button
   * is not rendered at all.
   */
  shareUrlFactory?: (() => Promise<string | null>) | null;
  /** Why Share cannot be pressed, in words. */
  shareReason?: string | null;
  /** Announced to the reader after a successful action, e.g. "PDF ready — WPR 01-01-2026 to 02-09-2026". */
  onMessage?: (message: string) => void;
};

/** The WhatsApp share, the same wa.me pattern the MoM object page already ships. */
export function whatsappShareHref(title: string, link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title}: ${link}`)}`;
}

/** A small menu anchored under its own word-button. Plain React state, so it works in a test and needs no portal. */
function MenuButton({
  label,
  icon,
  disabled,
  testId,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  testId: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Clicking anywhere else closes it -- a menu that stays open after the reader
  // has moved on is a menu covering the thing they moved on to.
  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
      >
        {icon} {label}
      </Button>
      {open && !disabled && (
        <div
          role="menu"
          data-testid={`${testId}-menu`}
          className="absolute right-0 z-30 mt-1 min-w-44 rounded-md border border-px-border bg-card p-1 shadow-md"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onSelect,
  href,
  icon,
  children,
  testId,
}: {
  onSelect?: () => void;
  href?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  testId: string;
}) {
  const className =
    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] text-px-ink hover:bg-px-cloud/60";
  if (href) {
    return (
      <a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" className={className} data-testid={testId} onClick={onSelect}>
        {icon} {children}
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" className={className} data-testid={testId} onClick={onSelect}>
      {icon} {children}
    </button>
  );
}

export function ExportShareActions({
  canExport,
  exportReason = null,
  title,
  pdfHref = null,
  xlsxHref = null,
  csvHref = null,
  onCsv = null,
  shareUrlFactory = null,
  shareReason = null,
  onMessage,
}: ExportShareActionsProps) {
  const [busy, setBusy] = useState(false);
  const exportDisabled = !canExport;
  // The reason is only worth showing when something is actually blocked.
  const shownExportReason = exportDisabled ? exportReason : null;
  const shownShareReason = shareUrlFactory && (shareReason || (!canExport ? exportReason : null));

  async function withLink(then: (url: string) => void) {
    if (!shareUrlFactory) return;
    setBusy(true);
    try {
      const url = await shareUrlFactory();
      if (url) then(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="export-share-actions">
      <MenuButton
        label="Export"
        icon={<Download className="size-4" />}
        disabled={exportDisabled}
        testId="export-menu-button"
      >
        {(close) => (
          <>
            {pdfHref && (
              <MenuItem
                href={pdfHref}
                icon={<FileText className="size-3.5" />}
                testId="export-pdf"
                onSelect={() => {
                  onMessage?.(`PDF ready — ${title}`);
                  close();
                }}
              >
                PDF
              </MenuItem>
            )}
            {xlsxHref && (
              <MenuItem
                href={xlsxHref}
                icon={<FileSpreadsheet className="size-3.5" />}
                testId="export-xlsx"
                onSelect={() => {
                  onMessage?.(`XLSX ready — ${title}`);
                  close();
                }}
              >
                XLSX
              </MenuItem>
            )}
            {onCsv ? (
              <MenuItem
                icon={<Download className="size-3.5" />}
                testId="export-csv"
                onSelect={() => {
                  onCsv();
                  close();
                }}
              >
                CSV
              </MenuItem>
            ) : csvHref ? (
              <MenuItem href={csvHref} icon={<Download className="size-3.5" />} testId="export-csv" onSelect={close}>
                CSV
              </MenuItem>
            ) : null}
          </>
        )}
      </MenuButton>

      {shareUrlFactory && (
        <MenuButton
          label="Share"
          icon={<Share2 className="size-4" />}
          disabled={busy || Boolean(shareReason) || !canExport}
          testId="share-menu-button"
        >
          {(close) => (
            <>
              <MenuItem
                icon={<Link2 className="size-3.5" />}
                testId="share-copy-link"
                onSelect={() => {
                  void withLink(async (url) => {
                    try {
                      await navigator.clipboard.writeText(url);
                      onMessage?.(`Link copied — ${title}`);
                    } catch {
                      onMessage?.(url);
                    }
                  });
                  close();
                }}
              >
                Copy link
              </MenuItem>
              <MenuItem
                icon={<MessageCircle className="size-3.5" />}
                testId="share-whatsapp"
                onSelect={() => {
                  void withLink((url) => {
                    // Same tab on a phone -- opening a second tab to hand off to
                    // another app leaves an empty one behind.
                    const target = typeof window !== "undefined" && window.innerWidth < 768 ? "_self" : "_blank";
                    window.open(whatsappShareHref(title, url), target, "noopener,noreferrer");
                  });
                  close();
                }}
              >
                Send via WhatsApp
              </MenuItem>
            </>
          )}
        </MenuButton>
      )}

      {/* The reason, in words, beside the button -- not only in a tooltip. */}
      {shownExportReason && (
        <span className="text-[12px] text-px-muted" data-testid="export-share-reason">
          {shownExportReason}
        </span>
      )}
      {!shownExportReason && shownShareReason && (
        <span className="text-[12px] text-px-muted" data-testid="export-share-reason">
          {shownShareReason}
        </span>
      )}
    </div>
  );
}
