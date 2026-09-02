"use client";

// R67 WS-A (A-01, A-07) -- PROJEXA'S FORK of the kit's shell/PillStrip, now a
// CARD strip.
//
// WHY A FORK (decision D-09): the kit's source is not in this repo and a
// node_modules edit is erased by CI's frozen-lockfile install. The forks are
// the components whose behaviour this programme changes.
//
// WHAT CHANGED FROM THE KIT COPY, and why (owner approval D-10):
//
//  1. IT RENDERS CARDS, NOT MODULE NAMES. "Permits" is a place; "Add permit"
//     is something a person can do. The first level is now six role-ranked
//     verb+object cards -- the catalogue and the ranking live in
//     src/lib/card-catalogue.ts, which is product data and belongs in this
//     repo, not in a shared kit.
//
//  2. THE KIND IS A WORD, not a colour. Every card carries its glyph AND the
//     word Record / Ask / Run. A strip whose meaning is carried by hue alone
//     is unreadable to a colour-blind user and to anyone holding a phone in
//     direct sunlight, which is most of the people this product is for.
//
//  3. A BLOCKED CARD STAYS AND EXPLAINS ITSELF. A card whose precondition is
//     missing is rendered, disabled, with the reason in words on the card
//     ("Run WPR - no BOQ on this project yet"). Hiding it would make the
//     strip's contents depend on invisible state and the user could never
//     learn the control exists.
//
//  4. "ALL MODULES" REPLACES "MORE MODULES", and expands in place to a FIXED
//     list (Sumeet's eleven, then "Other - type it", then the Platform group
//     holding the fourteen universal pills) that is never re-sorted by usage.
//     The ranked six answer "what do you do most"; the expanded list answers
//     "where is everything", and a list that moves is a list you must re-read.
//
//  5. NO FLICKER, AND THIS COMPONENT NEVER RE-SORTS. It renders `cards` in the
//     order it was given, every time; the order is decided entirely by the
//     caller. The strip paints from a cached ranking or the role's own
//     cold-start order, and three skeleton cards appear only when there is
//     genuinely neither. A-14: a newly arrived ranking is applied only at the
//     next navigation (src/lib/pill-ranking.ts), never under a moving finger,
//     which is how a user reaching for "Run WPR" pressed "Record progress".
//
// *** CLASSIFICATION NEVER AUTHORIZES *** is unchanged and load-bearing, and
// is now stronger than the kit's: the outward callback carries a card ID, a
// plain string. There is no object with a callable member anywhere on this
// path, so selecting a card cannot perform a write.

import { useEffect, useRef } from "react";

export type CardView = {
  id: string;
  label: string;
  /** "Record" | "Ask" | "Run" -- rendered as text, beside the glyph. */
  kindWord: string;
  kindGlyph: string;
  pinned: boolean;
  /** Words, on the card, when it cannot run here. Null when it can. */
  disabledReason: string | null;
};

/** R67 A-08 -- one "Do again" card: a whole chain this user really ran. */
export type RecentCardView = {
  fullChain: string;
  /** The closed-verb sentence, without the project root. */
  label: string;
  steps: readonly string[];
  projectId: string | null;
  /** "ok" | "failed". A failed chain is KEPT and shown -- the commonest
   *  reason to re-run something is that it went wrong. */
  outcome: string;
};

/**
 * R67 A-12 -- one entry of the expanded "All modules" list, as this component
 * needs it. Deliberately a VIEW type rather than the catalogue's own: the strip
 * renders words and reports an id, and holds nothing it could accidentally call.
 */
export type ModuleEntryView = {
  id: string;
  label: string;
  /** A-12: the pill's own key hint, already carrying its modifier ("Alt+P"). */
  shortcut?: string | null;
  /** Words that do NOT disable it -- "pick one in the top rail". */
  note?: string;
  /** Words that DO disable it -- today only "you are here". */
  unavailable?: string;
  /** A-17: this pill's own route is what is on screen right now. */
  pressed?: boolean;
};

export type PillStripProps = {
  cards: readonly CardView[];
  /** A-08: rendered at the front of the ranked band. Empty for a user with
   *  no recent chains, which is a normal first week and not a failure. */
  recent?: readonly RecentCardView[];
  onSelectRecent?: (chain: RecentCardView) => void;
  onSelect: (cardId: string) => void;
  onTogglePin?: (cardId: string) => void;
  /** True only when there is neither a cached ranking nor a known role. */
  loading?: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  allModules: readonly ModuleEntryView[];
  /** Reports the entry's ID. Never an object with a callable member. */
  onSelectModule: (entryId: string) => void;
  /**
   * Ranked keys this build has no card for. Warned once, never rendered: a raw
   * key like "work-progress.entry" on a strip is worse than a shorter strip.
   */
  unknownKeys?: readonly string[];
  /** One muted line under the cards -- a degraded read, or a first-run hint. */
  footnote?: React.ReactNode;
};

/** Three of these stand in for the six cards, and only when nothing at all is
 *  known yet. They are visibly placeholders, never plausible card labels. */
function SkeletonCards() {
  return (
    <div className="flex items-center gap-1" aria-hidden data-testid="card-skeletons">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-[26px] w-[104px] animate-pulse rounded-full"
          style={{ background: "var(--color-ct-border)" }}
        />
      ))}
    </div>
  );
}

export function PillStrip({
  cards,
  recent,
  onSelectRecent,
  onSelect,
  onTogglePin,
  loading = false,
  expanded,
  onToggleExpanded,
  allModules,
  onSelectModule,
  unknownKeys,
  footnote,
}: PillStripProps) {
  // Warned once per distinct set, in the console only. A key the server ranks
  // and this build cannot render is a deployment-skew fact for a developer,
  // never a sentence to put in front of a site engineer.
  const warnedRef = useRef<string>("");
  useEffect(() => {
    const signature = (unknownKeys ?? []).join(",");
    if (!signature || warnedRef.current === signature) return;
    warnedRef.current = signature;
    console.warn(
      `[composer] the server ranked ${unknownKeys!.length} key(s) this build has no card for and they were dropped: ${signature}`
    );
  }, [unknownKeys]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Things you can do">
        {loading ? (
          <>
            <SkeletonCards />
            <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
              Loading your modules…
            </span>
          </>
        ) : (
          <>
            {/* R67 A-08 -- "DO AGAIN". The three chains this user actually ran
                in the last seven days, at the front of the band, each labelled
                with the whole sentence rather than a fragment: M24 is explicit
                that "Import BOQ" alone is ambiguous. A click LOADS the sentence
                and opens its screen -- it never executes, and it carries no
                quantity from last time. A FAILED chain is shown too, and says
                so, because the commonest reason to repeat something is that it
                went wrong. */}
            {(recent ?? []).map((chain) => (
              <button
                key={chain.fullChain}
                type="button"
                onClick={() => onSelectRecent?.(chain)}
                aria-label={`Do again: ${chain.label}${chain.outcome === "failed" ? " (failed last time)" : ""}`}
                title={chain.fullChain}
                className="veri-mode-pill"
              >
                <span aria-hidden className="mr-1" style={{ color: "var(--color-ct-muted)" }}>
                  ↻
                </span>
                <span className="mr-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--color-ct-muted)" }}>
                  Do again
                </span>
                {chain.label}
                {chain.outcome === "failed" && (
                  <span className="ml-1 text-[10px]" style={{ color: "var(--color-veri-status-late)" }}>
                    failed last time
                  </span>
                )}
              </button>
            ))}
            {cards.map((card) => {
            const blocked = card.disabledReason !== null;
            return (
              <span key={card.id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => onSelect(card.id)}
                  disabled={blocked}
                  // NO FAIL-AFTER-CLICK: the reason is the accessible name and
                  // the tooltip, so it is available before the click, not after.
                  aria-label={blocked ? card.disabledReason! : `${card.kindWord}: ${card.label}`}
                  title={blocked ? card.disabledReason! : card.label}
                  className="veri-mode-pill disabled:opacity-45"
                >
                  <span aria-hidden className="mr-1" style={{ color: "var(--color-ct-muted)" }}>
                    {card.kindGlyph}
                  </span>
                  {/* THE KIND, IN WORDS. Never colour alone. */}
                  <span className="mr-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--color-ct-muted)" }}>
                    {card.kindWord}
                  </span>
                  {card.label}
                  {card.pinned && (
                    <span aria-hidden className="ml-1" style={{ color: "var(--color-ct-saffron)" }}>
                      ★
                    </span>
                  )}
                </button>
                {onTogglePin && (
                  <button
                    type="button"
                    onClick={() => onTogglePin(card.id)}
                    // Pinning is how a user defeats the 7-day decay for work
                    // they know is periodic. It needs a real label, not a star.
                    aria-label={card.pinned ? `Unpin ${card.label}` : `Pin ${card.label} so it never drops off`}
                    title={card.pinned ? "Unpin" : "Pin — never drops off"}
                    className="veri-icon-btn"
                    style={{ width: 20, height: 20, fontSize: 11 }}
                  >
                    {card.pinned ? "★" : "☆"}
                  </button>
                )}
              </span>
            );
            })}
          </>
        )}

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="veri-mode-pill"
          style={{ color: "var(--color-ct-muted)" }}
        >
          {expanded ? "Show fewer" : "All modules"}
        </button>
      </div>

      {expanded && (
        // FIXED ORDER, EXPANDED IN PLACE. Not a menu, not a dialog: the list
        // appears under the cards it belongs to and closes with "Show fewer".
        <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="All modules">
          {allModules.map((entry) => {
            const blocked = Boolean(entry.unavailable);
            // A-12: the note explains where the pill goes; it never refuses.
            const aside = entry.unavailable ?? entry.note;
            const name = aside ? `${entry.label} — ${aside}` : entry.label;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectModule(entry.id)}
                disabled={blocked}
                // A-17: aria-pressed while this pill's own route is open, so a
                // screen reader is told which of these the user is standing on
                // -- the same fact the sighted "you are here" note carries.
                aria-pressed={entry.pressed ?? undefined}
                aria-label={entry.shortcut ? `${name} (${entry.shortcut})` : name}
                title={entry.shortcut ? `${name} · ${entry.shortcut}` : name}
                className={`veri-mode-pill disabled:opacity-45${entry.pressed ? " active" : ""}`}
              >
                {entry.label}
                {aside && (
                  <span className="ml-1 text-[10px]" style={{ color: "var(--color-ct-muted)" }}>
                    — {aside}
                  </span>
                )}
                {/* A-12 -- THE KEY HINT, ON THE PILL. Shown with its modifier:
                    a hint reading "P" would be a shortcut that appears not to
                    work, because a bare letter has to stay typeable in the box
                    directly below this row. */}
                {entry.shortcut && (
                  <span
                    aria-hidden
                    className="ml-1.5 rounded px-1 text-[9px] tracking-wide"
                    style={{ background: "var(--color-ct-border)", color: "var(--color-ct-muted)" }}
                  >
                    {entry.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {footnote && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
          {footnote}
        </p>
      )}
    </div>
  );
}
