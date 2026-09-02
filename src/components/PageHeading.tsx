// veridian-ui-kit migration: AppTopbar used to be rendered per-page, with
// each page's title shown in its own sticky header bar. AppHeader (the shared
// package's replacement) is mounted exactly once from (app)/layout.tsx, so
// there's no longer a per-page header bar to put a page-specific title in --
// disclosed, deliberate simplification: each page's real title moves into
// its own content area as a plain heading instead. AppHeader's
// `contextLabel` slot shows the org name instead (see AppTopbar.tsx).
//
// R67 (audit R-083/R-084/R-086: "the module header band"). This was a bare
// <h1>, so every module invented its own header row and several put their
// primary action inside a tab body where it disappears on the other tabs, and
// none of them said WHICH PROJECT the rows on screen belong to (the top rail
// could read "All projects" while the data calls carried exactly one
// projectId). The heading now owns four things:
//
//   breadcrumb  - the trail above the title.
//   project     - the resolved project, printed beside the title in the
//                 context tint (--color-veri-status-context, from the kit's
//                 own token set), so the screen can never be silent about
//                 whose data it is showing.
//   note        - one line under the title, e.g. the "showing X because the
//                 rail is on All projects" disclosure.
//   actions     - the header action row, rendered in the order given and
//                 never reordered, so Filter | Export | + New is the same
//                 trio in the same place on every module.
//
// A disabled action carries its REASON in the visible label, in the product's
// existing "Label (reason)" form (matching /labour/new's own
// "Save (Name, Daily Rate)"), and repeats it in the title attribute -- a
// greyed-out control with no explanation is the defect this replaces.
//
// This file has no "use client" of its own: it is rendered both from server
// pages (title-only) and from client components that own the action handlers.
import { Button } from "@/components/ui/button";

export type PageHeadingAction = {
  label: string;
  onClick?: () => void;
  /** When set, the action is disabled and the reason is shown beside the label. */
  disabledReason?: string;
  /**
   * R67 D-37: disabled WITHOUT a parenthesised reason, for the one case where
   * the label itself already says what is happening -- an in-flight
   * "Opening…". A reason in brackets there would read as an explanation for a
   * refusal ("Opening… (Opening…)") rather than as progress.
   */
  disabled?: boolean;
  variant?: "default" | "outline";
  /** Optional stable hook for acceptance tests. */
  testId?: string;
};

export function PageHeading({
  title,
  breadcrumb,
  project,
  note,
  actions,
}: {
  title: string;
  breadcrumb?: React.ReactNode;
  project?: string | null;
  note?: React.ReactNode;
  actions?: PageHeadingAction[];
}) {
  return (
    <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb ? <p className="mb-0.5 text-[12px] text-px-muted">{breadcrumb}</p> : null}
        <h1 className="font-heading text-xl text-ct-navy flex flex-wrap items-baseline gap-x-2">
          <span>{title}</span>
          {project ? (
            <span className="text-[15px] font-medium text-[color:var(--color-veri-status-context)]">{project}</span>
          ) : null}
        </h1>
        {note ? <p className="mt-1 text-[13px] text-px-muted">{note}</p> : null}
      </div>
      {actions && actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              size="sm"
              variant={action.variant ?? "outline"}
              data-testid={action.testId}
              disabled={!!action.disabledReason || !!action.disabled}
              title={action.disabledReason}
              onClick={action.onClick}
            >
              {action.disabledReason ? `${action.label} (${action.disabledReason})` : action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
