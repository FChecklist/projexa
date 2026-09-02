"use client";

// R67 WS-A (A-01) -- PROJEXA'S FORK of the kit's shell/PillStrip.
//
// WHY A FORK (decision D-09): the kit's source is not in this repo and a
// node_modules edit is erased by CI's frozen-lockfile install. The forks are
// the components whose behaviour this programme changes.
//
// WHAT CHANGED FROM THE KIT COPY: one rule, `hide`.
//
// The strip used to render whatever the server ranked, unfiltered -- which on
// /dashboard meant a "Dashboard" pill and on /work-progress a "Work Progress"
// pill: a control whose only destination is the screen the user is already
// standing on. That is a dead end, and M24 forbids dead ends. `hide` is a
// predicate applied to BOTH the server's ranking and the local fallback
// ordering, so the rule cannot hold on one path and lapse on the other, and
// the limit is applied AFTER hiding so the strip still fills its six slots.
//
// *** CLASSIFICATION NEVER AUTHORIZES *** is unchanged and load-bearing: the
// only outward callback is onSelect(PillSelection), and PillSelection (still
// the kit's own type) has no callable member and a readonly `authorizes:
// false`. Picking a pill cannot perform a write, because there is nothing on
// the value it produces that could perform one.

import {
  UNIVERSAL_PILLS,
  rankPills,
  selectPill,
  type PillDef,
  type PillKey,
  type PillSelection,
  type PillUsage,
  type RankedPill,
} from "@fchecklist/veridian-ui-kit/shell";

export type PillStripProps = {
  /** compliance.pill_usage rows for THIS user. Used only for the OFFLINE
   *  fallback ordering when the server did not answer. */
  usage: PillUsage[];
  /** Injected so the fallback ordering is deterministic and testable. */
  now: number;
  /**
   * The server's ranking. WHEN PRESENT THIS WINS AND IS RENDERED VERBATIM --
   * the ranking is authoritative on the server and re-sorting it here would
   * silently produce a different strip from the one the backend computed.
   */
  ordered?: RankedPill[];
  activeKey?: string | null;
  onSelect: (selection: PillSelection) => void;
  onTogglePin?: (key: PillKey) => void;
  limit?: number;
  /**
   * A-01. Return true for a pill that must not be offered on this screen --
   * today, the pill whose destination IS this screen. Applied to the server's
   * ranking and to the local fallback alike, before the limit is taken.
   */
  hide?: (pill: { key: string; label: string }) => boolean;
};

export function PillStrip({
  usage,
  now,
  ordered,
  activeKey,
  onSelect,
  onTogglePin,
  limit,
  hide,
}: PillStripProps) {
  const fromServer = Boolean(ordered && ordered.length > 0);
  const max = limit ?? 6;

  const candidates: PillDef[] = fromServer
    ? // Rendered in the server's order. A pill the local set does not know
      // about still renders, using the server's own label -- the backend is
      // allowed to know about modules this build does not.
      ordered!.map((p, i) => {
        const known = UNIVERSAL_PILLS.find((u) => u.key === p.pillKey || u.label === p.pillKey);
        return known ?? ({ key: p.pillKey as PillKey, label: p.label ?? p.pillKey, sortOrder: i } as PillDef);
      })
    : // Ask for headroom before hiding, so removing the current screen's own
      // pill does not leave the strip one short.
      rankPills(usage, now, { limit: max + 4 });

  const pills = candidates.filter((p) => !hide?.({ key: p.key, label: p.label })).slice(0, max);

  const pinnedKeys = new Set<string>(
    fromServer
      ? ordered!.filter((p) => p.pinned).map((p) => p.pillKey)
      : usage.filter((r) => r.pinned).map((r) => r.pillKey)
  );

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Modules">
      {pills.map((p) => {
        const isPinned = pinnedKeys.has(p.key);
        return (
          <span key={p.key} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onSelect(selectPill(p))}
              aria-pressed={activeKey === p.key}
              className={`veri-mode-pill${activeKey === p.key ? " active" : ""}`}
            >
              {isPinned && (
                <span aria-hidden className="mr-1" style={{ color: "var(--color-ct-saffron)" }}>
                  ★
                </span>
              )}
              {p.label}
              {p.isFreeText && (
                <span aria-hidden className="ml-1" style={{ color: "var(--color-ct-muted)" }}>
                  …
                </span>
              )}
            </button>
            {onTogglePin && (
              <button
                type="button"
                onClick={() => onTogglePin(p.key)}
                // Pinning is how a user defeats the 7-day decay for work they
                // know is periodic. It needs a real label, not just a star.
                aria-label={isPinned ? `Unpin ${p.label}` : `Pin ${p.label} so it never drops off`}
                title={isPinned ? "Unpin" : "Pin — never drops off"}
                className="veri-icon-btn"
                style={{ width: 20, height: 20, fontSize: 11 }}
              >
                {isPinned ? "★" : "☆"}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
