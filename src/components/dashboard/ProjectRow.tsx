"use client";

// R67 E-01 (R-007): "the home dashboard is Sumeet's project list: one row per
// project with a % complete bar".
//
// The row this renders is the one /dashboard/overview already had (name + a
// horizontal bar, ProjectsOverviewClient) with the three things that screen
// lacked and the audit asks for: the money, the second percentage, and a
// status word. /dashboard/overview now redirects here, so this is the ONE
// project row in the product rather than a second copy of a shipped one.
//
// WHY A BUTTON AND NOT A DIV WITH onClick: the whole row is the target, so it
// has to be reachable and operable from the keyboard. A <button> gets Enter,
// Space, focus order and the right role for free -- hand-rolling those on a
// div is how a row ends up mouse-only.
//
// HOVER PREFETCHES the project dashboard. That page is a real multi-query read;
// starting it on hover is most of the difference between "instant" and "a
// second of nothing" for a reader working down the list.

import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { EMPTY_VALUE as EN_DASH, MONEY_CELL_CLASS } from "@/lib/format-money";
import { progressBarState, projectRowStatus, type DashboardProject } from "@/lib/dashboard-rows";

export const PROJECT_HREF_PREFIX = "/dashboard/project?projectId=";

export function projectHref(projectId: string): string {
  return `${PROJECT_HREF_PREFIX}${encodeURIComponent(projectId)}`;
}

/**
 * The bar. A hatched fill, not an empty one, when there is no BOQ -- an empty
 * track reads as "0 % done", and the label beside it says which of the two
 * this is in words as well.
 */
function ProgressBar({ project }: { project: DashboardProject }) {
  const state = progressBarState(project);
  if (state.kind === "unknown") {
    return (
      <div className="flex items-center gap-2">
        <div
          data-testid="project-row-bar-hatched"
          role="img"
          aria-label="No BOQ yet"
          className="h-2 flex-1 rounded-sm border border-px-border"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--color-ct-cloud) 0 4px, transparent 4px 8px)",
          }}
        />
        <span className="w-28 shrink-0 text-right text-[12px] text-px-muted">No BOQ yet</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div
        data-testid="project-row-bar"
        role="progressbar"
        aria-valuenow={state.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 flex-1 rounded-sm bg-px-cloud"
      >
        <div className="h-2 rounded-sm" style={{ width: `${state.percent}%`, backgroundColor: "var(--color-veri-status-done)" }} />
      </div>
      <span className="w-28 shrink-0 text-right text-[12px] tabular-nums text-px-ink">{state.percent}% by BOQ value</span>
    </div>
  );
}

/**
 * R67 E-19 (R-180): the four tabular figures under the bar. TABULAR, in a
 * fixed order, with the label above the figure -- so reading down a list of
 * rows compares Budget with Budget rather than hunting for it in a sentence
 * whose word order changes with the data. An absent figure is the en dash and
 * never a zero: "we do not have this" and "this is nothing" are different
 * facts, and only the second is a number.
 */
function RowFigures({
  project,
  money,
}: {
  project: DashboardProject;
  money: (value: number | string | null | undefined) => string;
}) {
  const percent = project.percentByValue;
  const cells: { label: string; value: string }[] = [
    { label: "Revenue", value: money(project.revenue) },
    { label: "Budget", value: money(project.budget) },
    { label: "Expense", value: money(project.expenses) },
    { label: "Progress", value: percent === null || percent === undefined ? EN_DASH : `${percent}%` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4" data-testid="project-row-figures">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <dt className="text-[10.5px] uppercase tracking-wide text-px-muted">{cell.label}</dt>
          {/* tabular-nums, but NOT MONEY_CELL_CLASS: these sit under their own
              left-aligned label in a four-column grid, so right-aligning them
              would part each figure from the word naming it. */}
          <dd className="whitespace-nowrap tabular-nums text-[12.5px] text-px-ink">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProjectRow({
  project,
  money,
  onOpen,
  onPrefetch,
  today,
}: {
  project: DashboardProject;
  /** The org money formatter -- passed in so a row can be rendered in a test without a currencies fetch. */
  money: (value: number | string | null | undefined) => string;
  /**
   * Client-side navigation for a plain left-click. Optional: the row is a real
   * anchor first, so it still works with this absent (and with JavaScript off).
   */
  onOpen?: (projectId: string) => void;
  onPrefetch?: (projectId: string) => void;
  /**
   * Today, as YYYY-MM-DD, resolved ONCE by the server component and passed
   * down. The stall signal is a date comparison, and computing "now" inside a
   * component that renders on both the server and the client is how a row ends
   * up saying 30 days on one pass and 31 on the other.
   */
  today?: string;
}) {
  const status = projectRowStatus(project, today);
  const href = projectHref(project.id);
  return (
    // R67 E-19 (R-180): a real <a href>, not a button. The item's acceptance
    // asks for a link, and the reasons behind that are the ones a button
    // cannot give: middle-click and cmd-click open the project in a new tab,
    // "copy link address" works, a crawler and a screen reader both see a
    // destination, and Enter still activates it. The click handler is an
    // ENHANCEMENT on top -- a plain left-click is intercepted for client-side
    // navigation, and every modified click falls through to the browser, which
    // is exactly what would break if this stayed a button with router.push.
    <a
      href={href}
      data-testid="project-row"
      onClick={(event) => {
        if (!onOpen) return;
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onOpen(project.id);
      }}
      onMouseEnter={onPrefetch ? () => onPrefetch(project.id) : undefined}
      onFocus={onPrefetch ? () => onPrefetch(project.id) : undefined}
      className="block w-full cursor-pointer space-y-1.5 rounded-md border border-px-border p-3 text-left transition-colors hover:bg-px-cloud/40"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium text-px-ink">{project.name}</span>
        {/* The contract and the spend, on one line, right-aligned so a reader
            comparing two rows compares two columns rather than two sentences. */}
        <span className={`${MONEY_CELL_CLASS} text-[12.5px] text-px-ink`}>
          {money(project.value)} contract · {money(project.expenses)} spent
        </span>
      </div>

      <ProgressBar project={project} />

      <RowFigures project={project} money={money} />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* The SECOND percentage, small and grey, because it answers a
            different question and disagrees with the bar on purpose: activity
            logs are not weighted by BOQ value. Absent, not zero, when nothing
            has been logged. */}
        <span className="text-[11.5px] text-px-muted">
          {project.percentByActivity === null || project.percentByActivity === undefined
            ? "No activity logged yet"
            : `${project.percentByActivity}% by activity log`}
        </span>
        {/* The word first, the glyph second -- the state must survive a
            greyscale print and a colour-blind reader. */}
        <span
          data-testid="project-row-status"
          className="inline-flex items-center gap-1 text-[12px]"
          style={{ color: status.needsYou ? "var(--status-late-text)" : "var(--status-done-text)" }}
        >
          {status.needsYou ? <AlertCircle className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          {status.label}
          {status.reasons.length > 0 && <span className="text-px-muted">— {status.reasons.join(", ")}</span>}
        </span>
      </div>
    </a>
  );
}

/** The row-shaped card an org with no projects sees instead of an empty panel. */
export function NoProjectsRow() {
  return (
    <a
      href="/projects/new"
      data-testid="no-projects-row"
      className="block w-full cursor-pointer rounded-md border border-dashed border-px-border p-4 text-left text-sm text-px-muted transition-colors hover:bg-px-cloud/40"
    >
      No projects yet — + New project
    </a>
  );
}

/** Client wrapper: owns the router so ProjectRow itself stays testable without one. */
export function ProjectRowList({
  projects,
  money,
  today,
}: {
  projects: DashboardProject[];
  money: (value: number | string | null | undefined) => string;
  /** Resolved once by the server component -- see ProjectRow's own note. */
  today?: string;
}) {
  const router = useRouter();
  if (projects.length === 0) return <NoProjectsRow />;
  return (
    <div className="space-y-2" data-testid="project-row-list">
      {projects.map((p) => (
        <ProjectRow
          key={p.id}
          project={p}
          money={money}
          today={today}
          onOpen={(id) => router.push(projectHref(id))}
          onPrefetch={(id) => router.prefetch(projectHref(id))}
        />
      ))}
    </div>
  );
}

/**
 * R67 E-19 (R-180): "Loading renders skeleton rows, never a spinner." A spinner
 * says only "wait"; row-shaped skeletons say what is coming and how much of it,
 * so the page does not visibly jump when the data lands. Exported so the route's
 * loading.tsx and any future caller render the SAME shape.
 */
export function ProjectRowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" data-testid="project-row-skeleton" aria-busy="true" aria-label="Loading projects">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 rounded-md border border-px-border p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="h-3.5 w-48 rounded bg-px-cloud" />
            <span className="h-3.5 w-40 rounded bg-px-cloud" />
          </div>
          <span className="block h-2 w-full rounded-sm bg-px-cloud" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {["Revenue", "Budget", "Expense", "Progress"].map((label) => (
              <span key={label} className="block h-6 rounded bg-px-cloud" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
