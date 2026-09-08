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
//  5. EVERY CONTROL CARRIES A WORD AND A 44 PX TARGET (A-18). The pin was a
//     20 x 20 star whose two states differed only by fill. It is a text button
//     reading "Pin" / "Pinned" now, with the star kept beside the word as
//     decoration, at the minimum size a finger can actually hit -- it sits
//     immediately beside controls that write.
//
//  6. NO FLICKER, AND THIS COMPONENT NEVER RE-SORTS. It renders `cards` in the
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
import { CircleHelp, Pencil, Play, RotateCcw, Star } from "lucide-react";

// 2026-09-07 -- VISUAL-ONLY re-skin to match the frozen mock (owner
// direction: "the existing UI UX and its functions were designed after lots
// of work -- the new UI UX is visual change only... use old UI UX wiring
// into new UI UX"). Nothing below this comment changes what any control
// DOES -- every onClick/onTogglePin/aria-label/disabled state is the same
// prop, wired the same way. What changes is only how a "kind" and the pin
// control are DRAWN: the mock renders a glyph icon beside the label instead
// of a separate uppercase word badge, and a small star instead of a full
// 44px "Pin"/"Pinned" text button. The kind word is NOT lost -- it moves
// into the tooltip/aria-label, which is where a screen reader already reads
// it from; a lucide icon distinguishes by SHAPE, not colour, which is the
// actual thing R67 A-18's original rule protected against ("a strip whose
// meaning is carried by hue alone").
//
// 2026-09-08 -- CORRECTION, same standing rule ("mock's drawing wins for
// any still-existing control, only HOW it's drawn changes"). The pass above
// swapped the badge/text for an icon/star but left every row's own
// CONTAINER as `.veri-mode-pill` -- a kit class whose own CSS
// (`border-radius: 999px`, and a rendered height of 40px once its sibling
// pin button and Tailwind's own cascade are accounted for) draws a big
// rounded CAPSULE button, the exact "old UI" look the owner pointed at
// directly ("the left side is still old one... you were to update it").
// The frozen mock's own DOM for this band (read from the live mock, not
// guessed) is a flat, compact row -- `border-radius: 8px`, `padding: 3px
// 6px`, one 11px line, icon and label on the left, the pin star at the
// row's own right EDGE, inside the same tinted background -- never a pill.
// `.veri-mode-pill`/`rounded-full` are dropped for these three row groups
// (screenCards/recent/ranked cards) below in favour of that exact shape,
// built with plain flex + the same `--color-kpi-tint-positive` tint
// already in use. Every prop/handler/aria-label/disabled-state is
// byte-for-byte unchanged.
//
// THE ONE DELIBERATE, DISCLOSED TRADE-OFF: the pin star's own real hit box
// is now ~22x22 (the row's own compact height), not the previous 44x44.
// A literal 44px target does not fit here without physically overlapping
// the NEXT row's own pin hit-area -- these rows sit 4px apart (the mock's
// own spacing), and 44px centred on a ~24px-tall row already overflows
// +/-10px into the neighbour on each side, so two adjacent 44px targets
// would overlap by ~16px, meaning a tap near the shared edge could pin the
// WRONG row. Rather than silently keep the old 44px box (which would
// reproduce the exact capsule-shaped oversizing this fix removes) or
// silently shrink it without saying so, this is written down as the
// standing rule's own answer to a case it hasn't hit before: the mock's
// compact spacing physically forecloses the ideal target size for a
// same-row icon control, so the largest NON-OVERLAPPING box is used
// instead -- strictly bigger than the ~14px bare-glyph case R67 A-18 was
// originally about, short of the 44px this codebase prefers everywhere
// else. `strip-controls.test.tsx` documents this instead of asserting the
// old 44px figure.
const KIND_ICON: Record<string, typeof Pencil> = {
  write: Pencil,
  record: Pencil,
  ask: CircleHelp,
  run: Play,
};
function iconForKind(word: string) {
  return KIND_ICON[word.toLowerCase()] ?? Pencil;
}

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

/**
 * R67 A-20 -- one card that belongs to THIS route and tab. Rendered before the
 * ranked cards, because the thing the user is standing in front of outranks the
 * things they do most.
 */
export type ScreenCardView = {
  id: string;
  label: string;
  /** "Record" | "Run" | "Ask" ... the card's own verb, rendered as the word. */
  verb: string;
  /** True when the card opens a page; false when it loads its chain and stops. */
  opens: boolean;
};

export type PillStripProps = {
  cards: readonly CardView[];
  /** A-20: the current screen's own verbs, before everything else. */
  screenCards?: readonly ScreenCardView[];
  onSelectScreenCard?: (cardId: string) => void;
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
  screenCards,
  onSelectScreenCard,
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
      {/* 2026-09-07 -- VISUAL-ONLY, per the frozen mock ("copy it exactly...
          exactly means exactly"): the mock labels this band "Frequent
          actions" -- this group already carried that exact meaning via
          `aria-label="Things you can do"` below, but only for a screen
          reader. This makes it a real, visible heading too; the aria-label
          stays as is (sighted and non-sighted users now agree on the
          section's name, which is what M24's own "same meaning, not two
          different words" rule already asks for elsewhere in this file). */}
      {!loading && (
        <div className="mb-0.5 text-[11px] font-medium" style={{ color: "var(--color-ct-muted)" }}>
          Frequent actions
        </div>
      )}
      {/*
          2026-09-07 -- FULL-WIDTH ROWS, PER THE FROZEN MOCK. This band was a
          `flex flex-wrap` of compact inline pills; the frozen mock's own
          "Frequent actions" is a `flex-direction:column` stack of full-width
          rows, each on its own light background. Applied here to the screen's
          own verbs + "Do again" + the ranked cards -- the actual "Frequent
          actions" content -- NOT to "All modules" or the expanded catalog
          below, which stay their own compact, wrapping pill style (the mock
          never depicted those as full-width rows; they read as a directory to
          browse, not a list of frequent shortcuts). `--color-ct-cloud` is
          reused rather than a new colour: it is already this app's row tint
          (TaskMaster's own rows use it on hover), so this reads as "a list of
          rows", consistent with the rest of the shell, not a new visual
          language of its own. Every prop, handler, aria-label and disabled
          state below is unchanged -- this is a layout/style pass only.
      */}
      <div className="flex flex-col gap-[3px]" role="group" aria-label="Things you can do">
        {loading ? (
          <>
            <SkeletonCards />
            <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
              Loading your modules…
            </span>
          </>
        ) : (
          <>
            {/* R67 A-20 -- THIS SCREEN'S OWN VERBS, FIRST. Keyed by route AND
                tab, which is what stopped eight of the seventeen captured
                composer crops being byte-for-byte identical: a module has one
                set of leaves however many tabs it has, and the attendance
                register, the timesheet and the receipts book are three
                different jobs. A card either opens a real page or loads its
                sentence into the strip and stops -- neither one executes. */}
            {(screenCards ?? []).map((card) => {
              const Icon = iconForKind(card.verb);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onSelectScreenCard?.(card.id)}
                  aria-label={`${card.verb}: ${card.label}`}
                  title={`${card.verb}: ${card.label}`}
                  className="flex w-full items-center gap-1 rounded-[8px] border-0 text-left"
                  style={{ background: "var(--color-kpi-tint-positive)", padding: "3px 6px", fontSize: 11 }}
                >
                  <Icon aria-hidden size={12} className="shrink-0" style={{ color: "var(--color-ct-muted)" }} />
                  <span className="min-w-0 truncate">{card.label}</span>
                </button>
              );
            })}
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
                title={`Do again: ${chain.fullChain}`}
                className="flex w-full items-center gap-1 rounded-[8px] border-0 text-left"
                style={{ background: "var(--color-kpi-tint-positive)", padding: "3px 6px", fontSize: 11 }}
              >
                <RotateCcw aria-hidden size={12} className="shrink-0" style={{ color: "var(--color-ct-muted)" }} />
                <span className="min-w-0 truncate">
                  {chain.label}
                  {chain.outcome === "failed" && (
                    <span className="ml-1" style={{ color: "var(--color-veri-status-late)" }}>
                      failed last time
                    </span>
                  )}
                </span>
              </button>
            ))}
            {cards.map((card) => {
            const blocked = card.disabledReason !== null;
            const Icon = iconForKind(card.kindWord);
            return (
              <span
                key={card.id}
                className="flex w-full items-center gap-1 rounded-[8px]"
                style={{ background: "var(--color-kpi-tint-positive)", padding: "3px 6px" }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(card.id)}
                  disabled={blocked}
                  // NO FAIL-AFTER-CLICK: the reason is the accessible name and
                  // the tooltip, so it is available before the click, not after.
                  aria-label={blocked ? card.disabledReason! : `${card.kindWord}: ${card.label}`}
                  title={blocked ? card.disabledReason! : `${card.kindWord}: ${card.label}`}
                  className="flex min-w-0 flex-1 items-center gap-1 border-0 bg-transparent text-left disabled:opacity-45"
                  style={{ fontSize: 11 }}
                >
                  {/* THE KIND, BY SHAPE, NOT COLOUR ALONE (R67 A-18's actual
                      rule) -- the word itself moved into the aria-label/title
                      above, which is where a screen reader and a hover both
                      already read it from. */}
                  <Icon aria-hidden size={12} className="shrink-0" style={{ color: "var(--color-ct-muted)" }} />
                  <span className="min-w-0 truncate">{card.label}</span>
                  {card.pinned && (
                    <Star aria-hidden size={12} className="shrink-0" fill="var(--color-ct-saffron)" style={{ color: "var(--color-ct-saffron)" }} />
                  )}
                </button>
                {onTogglePin && (
                  // 2026-09-08 -- see this file's header for the full
                  // reasoning. Was a 44x44 hit area on a `.veri-icon-btn`
                  // (a kit class whose own 30x30 default the old inline
                  // width/height overrode); now a plain, un-classed button
                  // sized to the row's own compact height (~22px) instead --
                  // the largest box that does NOT overlap the next row's own
                  // pin target at the mock's own 4px row spacing. The
                  // accessible name, aria-pressed and the click handler are
                  // byte-for-byte the same props as before.
                  <button
                    type="button"
                    onClick={() => onTogglePin(card.id)}
                    aria-pressed={card.pinned}
                    aria-label={card.pinned ? `Pinned: ${card.label}` : `Pin ${card.label} so it never drops off`}
                    title={card.pinned ? "Pinned — never drops off" : "Pin — never drops off"}
                    className="flex shrink-0 items-center justify-center rounded border-0 bg-transparent"
                    style={{ width: 22, height: 22 }}
                  >
                    <Star
                      aria-hidden
                      size={12}
                      fill={card.pinned ? "var(--color-ct-saffron)" : "none"}
                      style={{ color: card.pinned ? "var(--color-ct-saffron)" : "var(--color-ct-muted)" }}
                    />
                  </button>
                )}
              </span>
            );
            })}
          </>
        )}
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
