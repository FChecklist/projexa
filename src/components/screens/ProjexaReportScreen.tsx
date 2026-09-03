"use client";

// R67 E-22, under programme decision D-09: a FORK of the kit's ReportScreen
// into projexa, not an edit of node_modules (which CI erases) and not a kit
// release (which this programme does not do).
//
// WHY IT HAD TO BE FORKED, precisely. The kit's ReportHeaderBlock types
// `project` as a `string`, and R-207 requires the project name in a report's
// header to be a LINK to that project. A string cannot be a link. Everything
// else here is the kit's own structure and wording, kept deliberately close
// so the two do not drift: the same suppressed "+ New" (a report is not
// created from a report), the same tie-check banner that must render LOUDLY
// and disable export, the same header grid.
//
// WHAT THE FORK ADDS beyond the ReactNode project name:
//   * `generatedIn` -- how long the run took, printed beside the timestamp,
//     because "as of" without "how long" is what made a 24-second report feel
//     broken rather than slow;
//   * a FIXED footer order (Share | Export CSV | Export PDF), so the same
//     three controls are never in two orders on two reports.
//
// ScreenFrame, HeaderActionState and every other kit part are still imported
// from the kit -- only this one component is local.
import { ScreenFrame, type HeaderActionState } from "@fchecklist/veridian-ui-kit/screens";
import type { ReactNode } from "react";

export type ProjexaReportHeaderBlock = {
  /** The project, as a link. This is the one reason this component is a fork. */
  project: ReactNode;
  client?: string;
  /** e.g. "BOQ revision 3 (approved)". */
  revision?: string;
  period?: string;
  generatedAt: string;
  generatedBy: string;
  /** e.g. "2.7 s". */
  generatedIn?: string;
};

export type ProjexaReportScreenProps = {
  breadcrumb: ReactNode;
  headerBlock: ProjexaReportHeaderBlock;
  parameterBar?: ReactNode;
  /** null = the subtotals tie. A mismatch renders LOUDLY and the caller must disable export. */
  tieError?: string | null;
  shareAction?: HeaderActionState;
  exportCsvAction?: HeaderActionState;
  exportPdfAction?: HeaderActionState;
  children: ReactNode;
};

function FooterButton({ action }: { action?: HeaderActionState }) {
  if (!action) return null;
  const disabled = !!action.disabledReason;
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={disabled}
      title={action.disabledReason}
      className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-navy disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {action.label}
    </button>
  );
}

export function ProjexaReportScreen({
  breadcrumb,
  headerBlock,
  parameterBar,
  tieError,
  shareAction,
  exportCsvAction,
  exportPdfAction,
  children,
}: ProjexaReportScreenProps) {
  return (
    <ScreenFrame
      breadcrumb={breadcrumb}
      // REPORT.GLOBAL: "+ New not applicable -- SUPPRESSED, not greyed."
      filterAction={undefined}
      messages={[]}
      footerActions={
        <>
          <FooterButton action={shareAction} />
          <FooterButton action={exportCsvAction} />
          <FooterButton action={exportPdfAction} />
        </>
      }
    >
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-ct-border pb-3 text-[12px] text-ct-muted sm:grid-cols-3">
          <div className="font-medium text-ct-navy">{headerBlock.project}</div>
          {headerBlock.client && <div>Client: {headerBlock.client}</div>}
          {headerBlock.revision && <div>{headerBlock.revision}</div>}
          {headerBlock.period && <div>Period: {headerBlock.period}</div>}
          <div>
            Generated: {headerBlock.generatedAt}
            {headerBlock.generatedIn ? ` · ran in ${headerBlock.generatedIn}` : ""}
          </div>
          <div>By: {headerBlock.generatedBy}</div>
        </div>
        {parameterBar}
        {tieError && (
          <div
            role="alert"
            className="rounded-md border px-3 py-2 text-[13px]"
            style={{ borderColor: "var(--color-veri-status-late)", color: "var(--color-veri-status-late)" }}
          >
            {tieError}
          </div>
        )}
        {children}
      </div>
    </ScreenFrame>
  );
}
