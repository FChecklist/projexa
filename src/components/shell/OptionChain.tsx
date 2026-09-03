"use client";

// PROJEXA'S FORK of @fchecklist/veridian-ui-kit/shell/OptionChain.tsx (kit
// 0.7.0, commit 8134e07), taken under programme decision D-09: the kit source
// is not on this machine and is not published, so a behaviour change is made
// by forking the one file. ChainSegment/SegmentKind are still the kit's, so
// the shape a level hands back to the chain stays the kit's.
//
// WHAT THE FORK ADDS, ALL R67 WS-C (C-08). The kit's `multi` mode is a flat
// row of checkbox chips with no headings, no search and no way to say what an
// unticked chip MEANS. A twelve-worker roster rendered that way is a wall of
// names:
//
//   1. TRADE SUB-HEADINGS (`groups`). A foreman looks for "the carpenters",
//      not for a name in a list of twelve.
//   2. A SEARCH BOX (`searchBy`), because a fifty-worker roster is a real
//      roster and scrolling a chip wall is not an answer.
//   3. THE WORD BESIDE THE GLYPH (`uncheckedWord`). An unticked chip means
//      ABSENT, and that is money and a payroll row -- so it says "absent" in
//      words. M24: colour and a tick are never allowed to carry the meaning
//      on their own (~8% of men have colour-vision deficiency and
//      construction skews male).
//   4. A PER-CHIP SECONDARY TOGGLE (`secondary`), for "Half day".
//   5. A LIVE COUNT (`countLine`): "12 of 12 present".
//
// SPACE TOGGLES THE HIGHLIGHTED CHIP for free, and deliberately so: each chip
// is a real <input type="checkbox"> inside its label, exactly as the kit had
// it, so the browser's own keyboard behaviour is the implementation. A
// div-with-role="checkbox" would have needed a hand-written key handler that
// could drift from it.
//
// ------------------------- the kit's own notes ---------------------------
// M24 -- the option chain. After a pill narrows the mind to an entity, this is
// how the user walks ENTITY > ACTION > STEP one level at a time, and it is what
// fills the control strip in front of them.
//
// *** SELECTING AN OPTION NEVER EXECUTES *** -- the same rule as history and
// task clicks. onAdvance hands back a ChainSegment; building a chain is not
// running it. Execution is a separate, explicit submit, and permission is
// re-checked server-side there.

import { useMemo, useState } from "react";
import type { ChainSegment, SegmentKind } from "@fchecklist/veridian-ui-kit/shell";
// The filtering and the grouping are PURE and live in src/lib/option-grid.ts,
// where they are unit-tested directly. A rule as consequential as "a heading
// never survives its own group" should not be asserted only through a
// synthetic DOM event.
import { filterOptions, groupOptions } from "@/lib/option-grid";
// R67 C-12: the shortlist rule -- the two best matches for what the user
// typed, then "Show all 28 lines". Pure, and tested in gap-card.test.ts.
import { rankOptions, showAllLabel } from "@/lib/gap-card";

export type ChainOption = {
  id: string;
  label: string;
  /** A second string the search matches: C-08's search is "by name or trade". */
  keywords?: string;
  /** A leaf is the last step -- the thing that would actually be done. */
  isLeaf?: boolean;
  /** Present but not reachable yet, WITH the reason. Never a dead end. */
  unavailableReason?: string;
};

export type OptionChainGroup = { label: string; optionIds: readonly string[] };

export type OptionChainProps = {
  /** The question this level answers, e.g. "Which BOQ line?" */
  legend: string;
  options: ChainOption[];
  /** What kind of segment picking one of these produces. */
  kind: SegmentKind;
  selectedId?: string | null;
  /** Adds the picked option to the chain. Never runs it. */
  onAdvance: (segment: ChainSegment) => void;

  // --- the fork's own additions --------------------------------------------
  /** Multi-select levels use .veri-mchip instead of .veri-rchip. */
  multi?: boolean;
  selectedIds?: readonly string[];
  onToggle?: (id: string) => void;
  /** Sub-headings over the grid. Options in no group render under "Other". */
  groups?: readonly OptionChainGroup[];
  /** What an UNTICKED chip means, in words: "absent". */
  uncheckedWord?: string;
  /** A second, optional state per chip: "Half day". */
  secondary?: { label: string; activeIds: readonly string[]; onToggle: (id: string) => void };
  /** Renders a filter box; the string is what it says it filters by. */
  searchBy?: string;
  /** The live tally, in words: "12 of 12 present". */
  countLine?: string;

  // --- R67 C-12 ------------------------------------------------------------
  /**
   * What the user actually typed. The options that match it are promoted to
   * the front, so "record 50% on excavation" puts the excavation lines where
   * the eye lands first instead of hiding them at position 19 of 28.
   */
  bestFirstQuery?: string;
  /**
   * How many chips to show before "Show all 28 lines". A twenty-eight-chip
   * wall is not a question, it is a search problem the user did not ask for.
   * Ignored for grouped and multi-select levels, which have their own
   * headings and their own search box.
   */
  previewLimit?: number;
  /** The noun in that button: "lines", "workers", "reports". */
  previewNoun?: string;
};

export function OptionChain({
  legend,
  options,
  kind,
  selectedId,
  onAdvance,
  multi = false,
  selectedIds = [],
  onToggle,
  groups,
  uncheckedWord,
  secondary,
  searchBy,
  countLine,
  bestFirstQuery,
  previewLimit,
  previewNoun = "options",
}: OptionChainProps) {
  const [query, setQuery] = useState("");
  // R67 C-12: collapsed until the user asks for the rest. Keyed off nothing,
  // deliberately -- reopening the same level should not remember that the user
  // once expanded it, because the two best matches are the answer most of the
  // time and that is the point of the shortlist.
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => filterOptions(options, query), [options, query]);

  // R67 C-12: the two best matches for what the user typed, first. Only for a
  // flat single-select level: a grouped or multi-select level (the attendance
  // roster) has its own headings and its own search, and reordering it would
  // move a name out from under its trade.
  const shortlistable = !multi && !groups && typeof previewLimit === "number" && previewLimit > 0;
  const ordered = useMemo(() => {
    if (!shortlistable || !bestFirstQuery) return visible;
    const { best, rest } = rankOptions(visible, bestFirstQuery, previewLimit);
    return [...best, ...rest];
  }, [visible, shortlistable, bestFirstQuery, previewLimit]);

  // The chips actually drawn, and whether anything is being held back. A
  // search the user typed here always shows everything it matched -- hiding
  // results behind "Show all" after an explicit search would be absurd.
  const collapsed = shortlistable && !expanded && !query.trim() && ordered.length > previewLimit!;
  const shown = collapsed ? ordered.slice(0, previewLimit!) : ordered;
  const hiddenCount = ordered.length - shown.length;

  // Groups are rendered over the VISIBLE options, so a search that empties a
  // trade removes that trade's heading too -- a heading with nothing under it
  // reads as "everyone in this trade is gone", which is not what a filter did.
  const rendered = useMemo(() => groupOptions(shown, groups), [shown, groups]);

  if (options.length === 0) {
    // EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN (M24).
    return (
      <p className="text-[12px]" style={{ color: "var(--color-ct-muted)" }}>
        Nothing to choose here yet.
      </p>
    );
  }

  function renderChip(o: ChainOption) {
    if (multi) {
      const checked = selectedIds.includes(o.id);
      const half = secondary?.activeIds.includes(o.id) ?? false;
      return (
        <span key={o.id} className="inline-flex items-center gap-1">
          <label className={`veri-mchip${checked ? " checked" : ""}`}>
            <input type="checkbox" checked={checked} onChange={() => onToggle?.(o.id)} />
            <span>{o.label}</span>
            {/* THE WORD, NOT THE ABSENCE OF A TICK. */}
            {!checked && uncheckedWord && (
              <span className="ml-1 text-[10px]" style={{ color: "var(--color-veri-status-late)" }}>
                {uncheckedWord}
              </span>
            )}
            {checked && half && secondary && (
              <span className="ml-1 text-[10px]" style={{ color: "var(--color-ct-muted)" }}>
                {secondary.label.toLowerCase()}
              </span>
            )}
          </label>
          {checked && secondary && (
            <button
              type="button"
              aria-pressed={half}
              onClick={() => secondary.onToggle(o.id)}
              className="veri-view-tab"
              style={{ fontSize: 10, minHeight: 20 }}
              aria-label={`${secondary.label}: ${o.label}`}
            >
              {secondary.label}
            </button>
          )}
        </span>
      );
    }

    const checked = selectedId === o.id;
    const cls = ["veri-rchip", o.isLeaf ? "leaf" : "", checked ? "checked" : ""].filter(Boolean).join(" ");

    if (o.unavailableReason) {
      // Never a dead end: if a branch is shown at all, it says in words why it
      // cannot be picked, rather than silently doing nothing on click.
      return (
        <span
          key={o.id}
          className={cls}
          style={{ opacity: 0.5, cursor: "not-allowed" }}
          title={o.unavailableReason}
          aria-disabled
        >
          {o.label}
          <span className="ml-1.5 text-[10px]" style={{ color: "var(--color-ct-muted)" }}>
            {o.unavailableReason}
          </span>
        </span>
      );
    }

    return (
      <button
        key={o.id}
        type="button"
        aria-pressed={checked}
        className={cls}
        onClick={() => onAdvance({ id: o.id, label: o.label, kind })}
      >
        {o.label}
      </button>
    );
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
          {legend}
        </span>
        {countLine && (
          <span role="status" className="text-[11px] font-medium" style={{ color: "var(--color-ct-navy)" }}>
            {countLine}
          </span>
        )}
        {searchBy && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search by ${searchBy}`}
            aria-label={`Search by ${searchBy}`}
            className="rounded border px-2 py-0.5 text-[11.5px]"
            style={{ borderColor: "var(--color-ct-border2)", color: "var(--color-ct-navy)" }}
          />
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: "var(--color-ct-muted)" }}>
          Nothing matches “{query}”.
        </p>
      ) : (
        <>
          {rendered.map((group) => (
            <div key={group.label ?? "__all"} className="flex flex-wrap items-center gap-1.5">
              {group.label && (
                <span className="mr-1 text-[10.5px] font-semibold" style={{ color: "var(--color-ct-muted)" }}>
                  {group.label}
                </span>
              )}
              {group.options.map(renderChip)}
            </div>
          ))}
          {/* R67 C-12: the rest of the list is a WORD, not a scroll. It says
              how many there are, so the user knows the shortlist is a
              shortlist rather than the whole bill. */}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="veri-view-tab self-start"
              onClick={() => setExpanded(true)}
            >
              {showAllLabel(ordered.length, previewNoun)}
            </button>
          )}
          {expanded && shortlistable && ordered.length > previewLimit! && (
            <button
              type="button"
              className="veri-view-tab self-start"
              onClick={() => setExpanded(false)}
            >
              Show fewer
            </button>
          )}
        </>
      )}
    </fieldset>
  );
}
