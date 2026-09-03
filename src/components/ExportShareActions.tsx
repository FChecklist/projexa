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
// R67 E-18: the WhatsApp message is built by the ONE rule item E-12 already
// wrote, not a second one beside it -- the same reason this component exists.
import { whatsappHref, type ExportFormat } from "@/lib/report-document-actions";

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
   * Why a format this report does NOT have is missing, in words. A format with
   * neither an href nor a reason is simply absent; one with a reason appears in
   * the menu, disabled, carrying it -- so a reader who came looking for the
   * spreadsheet is told why there isn't one instead of hunting for a control
   * that was quietly removed.
   */
  formatReasons?: Partial<Record<ExportFormat, string>> | null;
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

/**
 * The share target for a phone. Opening a second tab to hand off to another
 * app leaves an empty one behind, so a narrow viewport navigates in place.
 * Exported so the rule is assertable without a window.
 */
export function whatsappTarget(viewportWidth: number): "_self" | "_blank" {
  return viewportWidth < 768 ? "_self" : "_blank";
}

/** The formats, in the one order every screen offers them. */
const EXPORT_MENU: { format: ExportFormat; icon: typeof FileText }[] = [
  { format: "pdf", icon: FileText },
  { format: "xlsx", icon: FileSpreadsheet },
  { format: "csv", icon: Download },
];

/**
 * The formats this screen really offers, upper-cased, in menu order. Only the
 * ones with somewhere to go: a format that is merely explained (a disabled
 * entry carrying its reason) is NOT announced as available, because the whole
 * point of the accessible name is that it can be trusted.
 */
export function offeredFormats(input: {
  pdfHref?: string | null;
  xlsxHref?: string | null;
  csvHref?: string | null;
  onCsv?: (() => void) | null;
}): string[] {
  const has: Record<ExportFormat, boolean> = {
    pdf: Boolean(input.pdfHref),
    xlsx: Boolean(input.xlsxHref),
    csv: Boolean(input.csvHref) || Boolean(input.onCsv),
  };
  return EXPORT_MENU.filter((entry) => has[entry.format]).map((entry) => entry.format.toUpperCase());
}

/** A small menu anchored under its own word-button. Plain React state, so it works in a test and needs no portal. */
function MenuButton({
  label,
  icon,
  disabled,
  testId,
  hiddenSuffix = null,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  testId: string;
  /**
   * Appended to the button's ACCESSIBLE NAME but not to its visible label.
   * Export's is the list of formats it really offers, so a screen reader hears
   * "Export PDF, XLSX, CSV" instead of a bare "Export" that gives no clue what
   * is behind it -- and item E-20's "a control labelled Export PDF is present"
   * is satisfiable without putting the six-button row R-178 is about back on
   * the screen. It lists only what is genuinely offered on THIS screen.
   */
  hiddenSuffix?: string | null;
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
        {hiddenSuffix && <span className="sr-only"> {hiddenSuffix}</span>}
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
  disabledReason = null,
}: {
  onSelect?: () => void;
  href?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  testId: string;
  /** Present = this entry cannot be chosen, and this is why, on the entry itself. */
  disabledReason?: string | null;
}) {
  const className =
    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] text-px-ink hover:bg-px-cloud/60";
  if (disabledReason) {
    return (
      <span role="menuitem" aria-disabled="true" data-testid={testId} className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] text-px-muted">
        {icon}
        <span>
          {children}
          <span className="block text-[11.5px]">{disabledReason}</span>
        </span>
      </span>
    );
  }
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
  formatReasons = null,
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
        hiddenSuffix={offeredFormats({ pdfHref, xlsxHref, csvHref, onCsv }).join(", ") || null}
      >
        {(close) => (
          <>
            {/* One loop over the three formats, in the order the header offers
                them, so a screen cannot end up with PDF above XLSX here and
                below it there. Each entry is either a real relay link, the
                browser-built CSV, or -- when this report has no such document
                -- a disabled entry carrying the reason. */}
            {EXPORT_MENU.map(({ format, icon: Icon }) => {
              const href = format === "pdf" ? pdfHref : format === "xlsx" ? xlsxHref : csvHref;
              const build = format === "csv" ? onCsv : null;
              const icon = <Icon className="size-3.5" />;
              const label = format.toUpperCase();
              if (build) {
                return (
                  <MenuItem key={format} icon={icon} testId={`export-${format}`} onSelect={() => { build(); close(); }}>
                    {label}
                  </MenuItem>
                );
              }
              if (href) {
                return (
                  <MenuItem
                    key={format}
                    href={href}
                    icon={icon}
                    testId={`export-${format}`}
                    onSelect={() => {
                      onMessage?.(`${label} ready — ${title}`);
                      close();
                    }}
                  >
                    {label}
                  </MenuItem>
                );
              }
              const reason = formatReasons?.[format];
              return reason ? (
                <MenuItem key={format} icon={icon} testId={`export-${format}`} disabledReason={reason}>
                  {label}
                </MenuItem>
              ) : null;
            })}
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
                    window.open(
                      whatsappHref(title, url),
                      whatsappTarget(typeof window === "undefined" ? 1024 : window.innerWidth),
                      "noopener,noreferrer"
                    );
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
