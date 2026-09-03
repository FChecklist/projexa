"use client";

// PROJEXA'S FORK of @fchecklist/veridian-ui-kit/shell/TaskMaster.tsx (kit
// 0.7.0, commit 8134e07), taken under programme decision D-09: the kit source
// is not on this machine and is not published, so a behaviour change is made
// by forking this one file. The chain API (loadChain, ChainLoad) is still the
// kit's, so the load-never-execute contract stays where it is enforced.
//
// THREE CHANGES, all R67 WS-C (C-01):
//
// 1. A PER-ROW ACTION SLOT. A blocked row used to be a dead end: it stated a
//    failure and offered nothing but "click the row". Each row now carries
//    word buttons from src/lib/task-errors.ts -- "Pick line", "Choose
//    project", "Type value", "Retry", "Dismiss" -- and the caller decides
//    what each does. A "fix" LOADS THE CHAIN AND STOPS; only "retry"
//    re-submits, and only for a transport failure where nothing was written.
//
// 2. THE TABS ACTUALLY FILTER. The kit renders two fixed groups ("Needs you"
//    / "Waiting on others") whatever tab is selected, so clicking Completed
//    changed the highlight and nothing else. The groups are now labelled and
//    supplied per tab by the caller (src/components/shell/task-row.ts's
//    tabView), and the second group is optional -- Approval Pending, In
//    Queue, Completed and History each render exactly one list.
//
// 3. EVERY EMPTY TAB STATES ITS OWN PURPOSE. "Nothing is waiting on you."
//    under the Completed tab was a wrong sentence, not merely a bland one.
//
// AND ONE MORE, R67 C-10:
//
// 4. A "SYSTEM" GROUP FOR WHAT NOBODY ON SITE CAN FIX. A pool timeout is not
//    a decision waiting on a foreman. Those rows are still shown -- hiding a
//    failure is how a write is silently lost -- but they sit under their own
//    heading with a Retry, below the divider, and out of the badge count.
//
// ------------------------- the kit's own notes ---------------------------
// M24 -- the LEFT pane (30%). Not a chat thread: chat built one here once and
// M24 records that as one of the three things it got wrong. This is TASK
// MASTER.
//
// DATA SOURCE, RULED: compliance.pipeline_tasks -- what the composer creates
// and what carries the chain. NOT compliance.tasks, which is a different,
// older system with 1,913 rows. This component takes rows as props and does
// not fetch, so the ruling is enforced at the call site in the product.

import { loadChain, type ChainLoad } from "@fchecklist/veridian-ui-kit/shell";
import type { ProjexaTaskRow, RowAction, TaskState, TaskTabId } from "./task-row";

/** M24: "IF NAMES TRUNCATE IN REAL USE THAT IS A NAMING FAILURE, NOT A LAYOUT
 *  ONE - shorten the name, do not widen the pane." */
export const LINE1_MAX = 40;
/** M24: "TEN ROWS VISIBLE." */
export const VISIBLE_ROWS = 10;

/** M24: four glyphs, FIXED COLUMN, NEVER COLOUR ALONE (~8% of men have
 *  colour-vision deficiency and construction skews male). */
const GLYPH: Record<TaskState, { char: string; label: string; color: string }> = {
  "needs-you": { char: "●", label: "Needs you", color: "var(--color-veri-status-needs-you)" },
  running: { char: "◐", label: "Running", color: "var(--color-veri-status-context)" },
  waiting: { char: "○", label: "Waiting on others", color: "var(--color-ct-muted)" },
  done: { char: "✓", label: "Done", color: "var(--color-veri-status-done)" },
};

const URGENCY: Record<ProjexaTaskRow["urgency"], { bg: string; fg: string; loud: boolean }> = {
  late: { bg: "#F7EDF1", fg: "var(--color-veri-status-late)", loud: true },
  today: { bg: "#FBF3E8", fg: "var(--color-veri-status-needs-you)", loud: false },
  later: { bg: "var(--color-ct-cloud)", fg: "var(--color-ct-muted)", loud: false },
  done: { bg: "#EDF4F0", fg: "var(--color-veri-status-done)", loud: false },
};

export type TaskTab = {
  id: TaskTabId;
  /**
   * R67 C-11: the label ALREADY CARRIES THE COUNT ("Completed (3)"), built by
   * task-row.ts's countedTabLabel from the same numbers the list is rendered
   * from. It used to be a separate badge element, which meant the word and the
   * number were assembled in two different places and could disagree; and a
   * tab whose count is genuinely unknown (History, whose 7-day rule the server
   * does not compute) now prints no number rather than a wrong one.
   */
  label: string;
};

export type TaskGroupView = {
  label: string;
  empty: string;
  rows: ProjexaTaskRow[];
  /** Two-line rows for the group that matters; one line for the rest (M24). */
  twoLine?: boolean;
  /**
   * R67 C-11: History is "grouped by day". When present these are rendered in
   * place of the flat list, newest day first, each under its own date heading.
   */
  dayGroups?: { key: string; label: string; rows: ProjexaTaskRow[] }[];
  /** "Showing the newest 50 of 120." -- only when the page is not the whole list. */
  note?: string | null;
};

export type TaskMasterProps = {
  tabs: TaskTab[];
  activeTab: TaskTabId;
  onTabChange: (id: TaskTabId) => void;
  /** The group pinned above the divider -- never the part that scrolls. */
  primary: TaskGroupView;
  /** Optional: only the Home tab has a second group. */
  secondary?: TaskGroupView;
  /**
   * R67 C-10: rows nobody on site can act on -- a pool timeout, an upstream
   * 5xx. Shown (hiding a failure is how a write is silently lost) but never
   * counted in a tab's badge.
   */
  system?: TaskGroupView;
  /** Loads the chain and opens the screen. NEVER executes. */
  onLoad: (load: ChainLoad) => void;
  /** A row's word button. The caller decides what "fix"/"retry"/"dismiss" do. */
  onRowAction?: (row: ProjexaTaskRow, action: RowAction) => void;
};

function UrgencyPill({ urgency, label }: { urgency: ProjexaTaskRow["urgency"]; label: string }) {
  const u = URGENCY[urgency];
  return (
    <span
      className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
      style={{ background: u.bg, color: u.fg, fontWeight: u.loud ? 600 : 500 }}
    >
      {label}
    </span>
  );
}

function Row({
  row,
  twoLine,
  onLoad,
  onRowAction,
}: {
  row: ProjexaTaskRow;
  twoLine: boolean;
  onLoad: (l: ChainLoad) => void;
  onRowAction?: (row: ProjexaTaskRow, action: RowAction) => void;
}) {
  const g = GLYPH[row.state];
  // R67 C-10: the title is built ONCE, in task-row.ts, where the
  // no-underscore guard lives. Concatenating it here again is how
  // "Record record_work_progress" got past that guard the first time.
  const line1 = row.title;
  return (
    <li>
      <div className="rounded-lg hover:bg-[var(--color-ct-cloud)]">
        <button
          type="button"
          onClick={() => onLoad(loadChain(row.chain, row.route))}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left"
        >
          {/* FIXED COLUMN. The glyph never moves, so the eye can scan it. */}
          <span aria-hidden className="mt-[2px] w-3.5 shrink-0 text-center text-[11px]" style={{ color: g.color }}>
            {g.char}
          </span>
          <span className="sr-only">{g.label}. </span>

          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <span
                className="truncate"
                style={{ fontSize: "12.5px", color: "var(--color-ct-navy)" }}
                title={line1.length > LINE1_MAX ? line1 : undefined}
              >
                {line1}
              </span>
              <UrgencyPill urgency={row.urgency} label={row.urgencyLabel} />
            </span>
            {twoLine && row.detail && (
              <span className="truncate" style={{ fontSize: "11px", color: "var(--color-ct-muted)" }}>
                {row.detail}
              </span>
            )}
          </span>
        </button>

        {/* C-01: NEVER A DEAD END. The row's own way out, in words, outside the
            row button because a button may not nest inside a button. Rendered
            only when the caller wired a handler AND the row has an action. */}
        {onRowAction && row.actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 pl-[26px]">
            {row.actions.map((action) => (
              <button
                key={action.kind}
                type="button"
                onClick={() => onRowAction(row, action)}
                className="veri-view-tab"
                style={{ minHeight: 24 }}
                aria-label={`${action.label}: ${line1}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Group({
  group,
  onLoad,
  onRowAction,
  limit,
}: {
  group: TaskGroupView;
  onLoad: (l: ChainLoad) => void;
  onRowAction?: (row: ProjexaTaskRow, action: RowAction) => void;
  limit?: number;
}) {
  const rows = typeof limit === "number" ? group.rows.slice(0, limit) : group.rows;
  const twoLine = group.twoLine ?? true;
  return (
    <>
      <p className="px-2 pb-1 text-[11px] font-semibold" style={{ color: "var(--color-ct-navy)" }}>
        {group.label}
      </p>
      {group.rows.length === 0 ? (
        // M24: "EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN" -- and, C-01,
        // must say what THIS tab is for rather than borrowing another's words.
        <p className="px-2 pb-2 text-[11.5px]" style={{ color: "var(--color-ct-muted)" }}>
          {group.empty}
        </p>
      ) : group.dayGroups ? (
        // R67 C-11: History, by day. The heading is the day, so "when did we
        // finish that" is read off the list instead of worked out from five
        // identical-looking rows.
        <div className="space-y-2">
          {group.dayGroups.map((day) => (
            <div key={day.key}>
              <p className="px-2 pb-0.5 text-[10.5px] uppercase tracking-wide" style={{ color: "var(--color-ct-muted)" }}>
                {day.label}
              </p>
              <ul className="space-y-0.5">
                {day.rows.map((r) => (
                  <Row key={r.id} row={r} twoLine={twoLine} onLoad={onLoad} onRowAction={onRowAction} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <Row key={r.id} row={r} twoLine={twoLine} onLoad={onLoad} onRowAction={onRowAction} />
          ))}
        </ul>
      )}
      {/* A PAGE IS NOT A LIST, AND THE DIFFERENCE IS SAID IN WORDS. Without
          this the count on the tab and the rows beneath it look like they
          disagree, when in fact one is a total and the other is a page. */}
      {group.note && (
        <p className="px-2 pb-1 pt-1 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
          {group.note}
        </p>
      )}
    </>
  );
}

export function TaskMaster({ tabs, activeTab, onTabChange, primary, secondary, system, onLoad, onRowAction }: TaskMasterProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--color-ct-cream)" }}>
      {/* WRAPS, never scrolls horizontally: in the 30% pane five tabs overflow,
          and M24 is explicit that the answer to a name not fitting is never to
          widen the pane. */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b px-2 py-1.5"
        style={{ borderColor: "var(--color-ct-border)" }}
        role="tablist"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => onTabChange(t.id)}
            className={`veri-view-tab shrink-0 whitespace-nowrap${activeTab === t.id ? " active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* *** M24: "PIN THE 'NEEDS YOU' GROUP so it is never the part that
          scrolls under the expanded composer." *** Only when there is a second
          group to scroll: a single-group tab gets the whole pane and scrolls
          normally, so a long Completed list is not clipped at ten rows. */}
      {secondary ? (
        <>
          <div className="shrink-0 px-2 pt-2">
            <Group group={primary} onLoad={onLoad} onRowAction={onRowAction} limit={VISIBLE_ROWS} />
          </div>
          <div className="mx-2 my-2 h-px shrink-0" style={{ background: "var(--color-ct-border2)" }} />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <Group group={secondary} onLoad={onLoad} onRowAction={onRowAction} />
            {system && system.rows.length > 0 && (
              <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--color-ct-border2)" }}>
                <Group group={system} onLoad={onLoad} onRowAction={onRowAction} />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
          <Group group={primary} onLoad={onLoad} onRowAction={onRowAction} />
          {system && system.rows.length > 0 && (
            <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--color-ct-border2)" }}>
              <Group group={system} onLoad={onLoad} onRowAction={onRowAction} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
