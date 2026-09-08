"use client";

// R67 WS-A (A-01) -- PROJEXA'S FORK of the kit's shell/Composer.
//
// WHY A FORK AND NOT A KIT CHANGE: decision D-09. The kit is a pinned git
// dependency whose source is not on this machine and is not published, and a
// node_modules edit is erased by CI's `bun install --frozen-lockfile`. Only
// the components whose behaviour this programme changes are copied here; the
// frame (AppShell), the rail (TopRail), the Task Master and the screens are
// still the kit's.
//
// M24-A's design rules are carried over verbatim and must not drift:
// the box is where work happens, it sizes ITSELF (no drag, no resize handle,
// no pin), and it spans both panes rather than being confined to one.
//
// WHAT CHANGED FROM THE KIT COPY:
//
//  1. NO HISTORY DROP. The kit rendered a HistoryDrop under the strip, giving
//     the screen two controls named History (the other is the Task Master's
//     own tab). The drop is gone -- not hidden, not restyled -- and with it
//     the `history` / `suggestedHistory` / `onLoadChain` props. Loading a
//     previous chain is the Task Master History tab's job, and it keeps the
//     same load-and-stop contract. HistoryDrop.tsx is deliberately NOT copied
//     into this repo. (R67 MERGE, D-11: WS-C independently reached the same
//     finding and kept a HISTORY shortcut wired to `onHistory` -- this merge
//     keeps WS-A's fuller removal; see ControlStrip.tsx's own header.)
//
//  2. NO MODE ROW, so no `onModeChange` prop -- see ControlStrip.tsx.
//
//  3. ONE INSTRUCTION. The kit printed a grey `disabledReason` beside the Send
//     button while the strip printed its own fixed "Select a module to begin",
//     so a blocked user read two different sentences about one state. There is
//     now a single `instruction`, rendered ONCE in the strip and reused
//     verbatim as the Send button's tooltip and accessible name. A real
//     failure (`errorMessage`) is a different thing and still gets its own
//     line, in red, with role="alert". (This is WS-A's `instruction`/`canSend`
//     mechanism; it supersedes WS-C's own `disabledReason` /
//     `emptyInputReason` / `allowEmptySubmit`, which asked the same three
//     questions -- what's missing, what an empty box means, whether Send is
//     armed -- through three separate props instead of one state-derived
//     string. Nothing WS-C tested is lost: composer-send-state.ts's
//     sendLabelFor still computes the sentence, it is simply passed in as
//     `instruction`/`canSend` rather than recomputed inside this file.)
//
//  4. SEND IS DRIVEN BY `canSend`, not by the textarea being non-empty. The
//     kit disabled Send whenever the box was empty, which made the pill path
//     -- pick a module, press Send, no typing required -- silently impossible.
//     The caller decides what is submittable and says why in one string.
//
//  5. THE BUTTON IS NAMED FOR WHAT IT WILL DO (A-10): "Save progress", "Ask",
//     "Run", or "Send" for free text -- and while a submission is in flight the
//     LABEL DOES NOT CHANGE. Replacing it with "Sending..." destroys the one
//     word the user was reading to decide whether to press it and makes the
//     button jump width mid-click; a spinner sits beside it instead.
//
//  6. THE FAILURE LINE MOVED ONTO THE BUTTON'S OWN ROW (A-10), immediately to
//     its left, instead of floating above the textarea where the composer's
//     own growth could push it off. The row has a 44 px minimum height so the
//     button is a real touch target on the phone this product is used on.
//
//  7. NAVY ON SAFFRON (A-10, WS-G tokens, no new colour). White on saffron was
//     the contrast failure; the navy already in the palette fixes it without
//     inventing a shade.
//
//  8. THE REASON IS IN THE BUTTON'S NAME (A-19). "Send (pick a project, say
//     what you need)" -- so the answer to "why can't I press this" is written
//     on the thing being pressed, and the accessible name is exactly the label
//     rather than the label plus a second sentence appended to it.
//
//  9. INK AND GREY ARE CLASSES, NOT CONTENT (A-19), and a value the user did
//     NOT type is selected on focus so it reads as a draft they may replace.
//
//  10. R67 C-14 (WS-C, kept -- see `messages` below): A SHELL MESSAGE REGION,
//      above the box and outside it -- a receipt for something a page's own
//      form saved, or the sentence for a failure nobody on site can fix.
//
//  11. R67 C-04 (WS-C, kept -- see `fieldsSlot` below): BAND 4'S LABELLED
//      SCALAR FIELDS, for a chain step whose answer is a number or a date.

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import {
  COMPOSER_MAX_HEIGHT_VH,
  COMPOSER_RESTING_HEIGHT,
  type Chain,
} from "@fchecklist/veridian-ui-kit/shell";
import { ControlStrip } from "./ControlStrip";

export type ComposerProps = {
  chain: Chain;
  onCutFrom: (index: number) => void;
  onSegmentClick?: (index: number) => void;
  /** 2026-09-07: threaded straight through to ControlStrip's own Back button
   *  -- see that file's ADDENDUM. Composer.tsx itself has no chain logic of
   *  its own to add here, same as onCutFrom/onHome/onReset above it. */
  onBack: () => void;
  onHome: () => void;
  onReset: () => void;

  /**
   * THE ONE STATE-DERIVED INSTRUCTION (A-01/A-10). Rendered in the strip, and
   * reused verbatim as the Send button's tooltip -- never printed twice. Empty
   * when the sentence is complete: there is no next question then, and the
   * button's own name says what will happen.
   */
  instruction: string;
  /**
   * A-10: what the button says. "Save progress" | "Ask" | "Run" | "Send", or
   * the blocked form "Record progress (1 required field)". Never "Sending...".
   */
  sendLabel?: string;
  /** When false, Send is disabled and `instruction` says what is missing. */
  canSend: boolean;
  /** A real failure, e.g. a rejected submission. Shown in words, in red. */
  errorMessage?: string | null;
  /** A submission is in flight: Send is inert and the box says so to AT. */
  busy?: boolean;
  /** A-09: set when the chain was loaded from history. Passed straight through
   *  to the strip, which is where the sentence it describes is rendered. */
  loaded?: {
    from: string | null;
    pinned: boolean;
    onTogglePin: () => void;
  } | null;
  /** 2026-09-07: passed straight through to ControlStrip -- see its own
   *  doc comment. The SAME `showAllPills` state M24Shell.tsx already
   *  threads to the pills band, just also reaching the control strip now
   *  that the mock's own toggle position moved there. */
  allModulesExpanded?: boolean;
  onToggleAllModules?: () => void;
  /** 2026-09-08 -- threaded straight through to ControlStrip's own TASKS
   *  button; see that file's header and `dockedOverTaskMaster` below for
   *  the full mechanism. */
  onToggleTasks?: () => void;
  tasksExpanded?: boolean;
  /**
   * 2026-09-08 -- THE MOCK'S DEFAULT VIEW HAS NO TASK MASTER PANE AT ALL
   * (owner, looking at real Chrome: "the home, approved pending, in
   * queue... is still in the top... the Frequently Used is missing" --
   * confirmed by reading the frozen mock's own DOM: "Frequent actions" is
   * the very first thing in the left panel, nothing above it). Every
   * absolute/bottom-anchored/grows-upward mechanic below this comment was
   * built, and repeatedly bug-fixed, on the premise that this composer
   * floats OVER a Task Master pane that is always there and always taller
   * than the composer itself -- which is only true while that pane is
   * actually showing.
   *
   * Default `true` is that exact, unchanged, already-hardened behaviour --
   * every existing caller/test that doesn't pass this prop keeps rendering
   * byte-for-byte the same DOM it always did. `false` is the NEW state,
   * used only when M24Shell.tsx's own `tasksExpanded` is false (the mock's
   * default): there is no Task Master pane to float over in that state --
   * this component IS the whole of the left pane's content below the rail
   * -- so it renders in normal top-anchored flow instead, exactly like any
   * other block of content, rather than pinned to the bottom of a
   * container it no longer shares with anything.
   */
  dockedOverTaskMaster?: boolean;

  /**
   * R67 C-14: THE SHELL MESSAGE REGION, above the box.
   *
   * The spec's FOOTER MESSAGE AREA. It sits OUTSIDE the bordered composer and
   * directly above it, because it is the shell's voice rather than the
   * conversation's: a receipt for something a page's own form saved, or the
   * sentence for a failure nobody on site can fix. Band 2 is where the
   * composer answers for what IT did; this is where the product answers for
   * everything else, and the two are deliberately not the same surface.
   */
  messages?: ReactNode;
  /** 2. CONVERSATION -- rendered only once there is something to show. */
  conversation?: ReactNode;
  /** 3. PILLS -- the ranked card strip. */
  pills?: ReactNode;
  /** Two worked examples under the input (A-02). */
  examples?: ReactNode;

  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  attachSlot?: ReactNode;
  /**
   * R67 C-04: BAND 4'S LABELLED SCALAR FIELDS.
   *
   * A chain step whose value is a number or a date -- a quantity, a
   * percentage, a day -- is not a chip row: there are too many answers to
   * show and the user already knows theirs. It is a field, and it belongs in
   * the INPUT band beside the thing it is an input to, not in the
   * conversation band above it. Rendered above the textarea so the label is
   * read before the box, and copying the /labour/new "Save (Name, Daily
   * Rate)" pattern: the field says what it wants, and validation happens on
   * blur rather than after Send.
   */
  fieldsSlot?: ReactNode;
  /** Lets the shell put the cursor in the box (reset, "Other…", prefill). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /**
   * 2026-09-07 -- MEASURED, NOT GUESSED. Found live while verifying
   * AppShell.tsx's unified left-pane card (that file's own ADDENDUM 2):
   * AppShell reserves COMPOSER_RESTING_HEIGHT + composerReserveExtra of
   * padding at the bottom of the Task Master scroll area so this
   * absolutely-positioned box never covers a task row -- but that sum was a
   * STATIC guess (112 + 96 = 208px), and this component's real height is not
   * static. It grows with however many "Frequent actions" pills are ranked,
   * whether a "Do again" recent-chain row is showing, and whether any pill
   * without a chosen project prints its own "Choose project" sub-line.
   * Measured live in one real state (Home tab, a fresh chain, several
   * pills): this component rendered at 446px while only 208px was reserved
   * -- a 238px shortfall that visibly covered "Pick line"/"Dismiss" on the
   * task rows above it. F_019's own comment already named this general
   * failure mode ("the composer's real resting height is always taller than
   * AppShell's own default reserve") for the ERP pane; this is the same
   * class of bug on the Task Master side. Fixed by reporting this
   * component's OWN actual rendered height on every change (a
   * ResizeObserver on its root, below) through this callback, rather than
   * tuning yet another magic constant -- the caller (M24Shell.tsx) turns
   * that into the real composerReserveExtra AppShell needs.
   */
  onHeightChange?: (px: number) => void;
};

export function Composer({
  chain,
  onCutFrom,
  onSegmentClick,
  onBack,
  onHome,
  onReset,
  instruction,
  sendLabel = "Send",
  canSend,
  errorMessage,
  busy = false,
  loaded,
  allModulesExpanded,
  onToggleAllModules,
  onToggleTasks,
  tasksExpanded,
  dockedOverTaskMaster = true,
  messages,
  conversation,
  pills,
  examples,
  value,
  onChange,
  onSubmit,
  // The kit's default was "Describe what you need, or pick a module above.",
  // which contradicted the strip's own instruction; retired with the rest.
  placeholder = "Type a task, a question or a record",
  attachSlot,
  fieldsSlot,
  textareaRef,
  onHeightChange,
}: ComposerProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef ?? ownRef;
  // R67 A-19 -- WHAT THE USER LAST TYPED, so a value that arrived some other
  // way can be told apart from one they wrote. See the focus handler below.
  const lastTypedRef = useRef("");

  // See onHeightChange's own doc comment above. Observes THIS component's
  // real root (the absolutely-positioned box that actually grows/shrinks),
  // not a proxy for it -- an ordinary wrapper around an absolutely-positioned
  // child would report zero height, since an absolutely-positioned element
  // is taken out of normal flow and contributes nothing to a parent's box.
  const rootRef = useRef<HTMLDivElement>(null);

  // 2026-09-07 -- FOUND LIVE: a ResizeObserver-only measurement went stale
  // under real use. Reproduced and measured directly: after clicking a
  // pill that needs a project (opening the project-picker AND its own
  // pills together), the composer's real height grew to 537px while the
  // reservation this component had last reported was still 381px (269 +
  // COMPOSER_RESTING_HEIGHT) -- a 156px gap that persisted for multiple
  // seconds, not a one-frame race. ResizeObserver reports changes to an
  // element's OWN computed box; exactly why it missed this particular
  // growth (some combination of how many DOM nodes changed at once in one
  // React commit, and this component's `flex flex-col justify-end` root
  // computing its used height from overflowing children rather than a
  // simple property change) wasn't fully isolated, but the fix does not
  // depend on isolating it: a `useLayoutEffect` with NO dependency array
  // runs after every single commit, synchronously, before the browser
  // paints -- so it re-measures every time this component's own render
  // output could have changed the DOM, independent of whether
  // ResizeObserver's own change-detection happens to fire. The
  // ResizeObserver stays too, as a genuinely separate case this effect
  // cannot cover on its own: a size change with no React re-render at all
  // (e.g. a web font finishing its load and reflowing text width/height).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeightChange) return;
    onHeightChange(el.getBoundingClientRect().height);
  });
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  // The box sizes ITSELF. This is the whole of the sizing logic, and it is
  // deliberately not user-controllable.
  //
  // 2026-09-08 -- FOUND LIVE: a STALE measurement, not a value change. The
  // effect below used to depend on `[value, taRef]` alone, on the
  // assumption that the only thing that ever needs a fresh height is new
  // text. Collapsing Task Master (this file's own `dockedOverTaskMaster`
  // prop, part of the same change) relayouts this textarea from an
  // absolutely-positioned box whose width was always immediately stable to
  // a normal-flow one whose real width can still be settling for a frame
  // or two while the sibling Task Master area's reserved height animates
  // to 0 -- and a `scrollHeight` read taken against that transitional,
  // too-narrow width wraps the 2-row placeholder into many lines,
  // producing a bogus large number that then clamps at the 220px ceiling
  // and STAYS there forever, because nothing in `[value, taRef]` ever
  // changes again to re-run this effect. Confirmed live: manually
  // resetting `style.height = "auto"` after the page had fully settled
  // measured a real `scrollHeight` of 46px, not 220 -- the layout was
  // correct, only the ONE measurement taken during the transition was not.
  //
  // Same class of bug as `rootRef`'s own ResizeObserver above (see its
  // comment: "measure again once layout truly settles"), same fix: switch
  // the initial call to a dependency-free `useLayoutEffect` (reruns after
  // every commit, not just a `value` change) and add a ResizeObserver on
  // the textarea's own parent so a LATER, non-React-driven layout settle
  // (exactly what Task Master's height animating to 0 is) re-measures too.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  });
  useEffect(() => {
    const ta = taRef.current;
    const container = ta?.parentElement;
    if (!ta || !container) return;
    const resize = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [taRef]);

  const sendDisabled = !canSend || busy || !onSubmit;

  return (
    <div
      ref={rootRef}
      className={
        dockedOverTaskMaster
          ? "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end px-3 pb-3"
          : // 2026-09-08 -- no Task Master pane to float over (see this
            // prop's own doc comment above): normal flow, top-anchored,
            // no z-index/pointer-events dance needed because nothing sits
            // behind this to click through to.
            //
            // R80 PART 4: `min-h-0 flex-1` so this FILLS the left pane's
            // remaining height (AppShell's own wrapper is a `flex-1
            // flex-col`, and the Task Master area above collapses to 0 in
            // this state) rather than taking only its content's natural
            // height. A definite height is what makes "three equal
            // vertical thirds" below mean anything at all -- thirds of a
            // content-sized box would just be the content again.
            "relative flex min-h-0 flex-1 flex-col px-3 pb-3"
      }
      style={dockedOverTaskMaster ? { maxHeight: `${COMPOSER_MAX_HEIGHT_VH}vh` } : undefined}
    >
      {/* R67 C-14: the message region, above the box and outside it. It
          renders nothing at all when there is nothing to say, so it costs the
          input band no height on a phone. */}
      {messages}
      {/*
          2026-09-07: lost its own rounded-xl/border/shadow-sm/white
          background here -- AppShell.tsx's ADDENDUM 2 now wraps this
          component together with TaskMaster in ONE shared card (matching the
          frozen mock's single continuous surface), so a second, independent
          card border/shadow directly underneath TaskMaster's own content
          read as two stacked panels rather than the mock's one. The growth
          mechanism itself (min/maxHeight, the outer absolute wrapper above)
          is completely unchanged -- only the visual chrome moved up a level.
      */}
      <div
        // R80 PART 4 -- THREE EQUAL VERTICAL THIRDS, owner's own words:
        // "DIVIDE THE LEFT SIDE IN 3 EQUAL PARTS VERTICALLY / PART 1 (TOP
        // LEFT) - FREQUENT ACTIONS / PART 2 (MIDDLE LEFT) - MODE PILLS /
        // OPTION SELECTION CHAIN / PART 3 - (BOTTOM LEFT) - CHAT BOX".
        // When undocked (Task Master collapsed -- the default), this box
        // fills the pane (`min-h-0 flex-1`) and its three children below
        // each take `flex-1 basis-0`, i.e. exactly one third each,
        // scrolling internally instead of pushing a sibling off. The
        // DOCKED case is deliberately left on the old content-sized
        // min/maxHeight growth mechanism -- there the composer floats over
        // a real Task Master pane and must stay as short as its content,
        // which is the opposite of filling a third of anything.
        className={
          dockedOverTaskMaster
            ? "pointer-events-auto relative flex w-full flex-col overflow-visible"
            : "pointer-events-auto relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
        }
        style={
          dockedOverTaskMaster
            ? { minHeight: COMPOSER_RESTING_HEIGHT, maxHeight: `${COMPOSER_MAX_HEIGHT_VH}vh` }
            : undefined
        }
      >
        {/*
            2026-09-07 -- REORDERED to match the frozen mock's own vertical
            sequence ("Frequent actions" prominent near the top; "the
            All modules / Tasks / Back / Home control bar sits right above
            the chat box"). Band NUMBERS/PROP NAMES are unchanged (pills is
            still "band 3", conversation "band 2" in every comment
            elsewhere in this file and in M24Shell.tsx that names them by
            prop) -- only where each one renders moved. This is safe for the
            conversation band's own grow-upward flex-1 mechanic: flexbox
            gives a flex-1 child whatever space is left over regardless of
            its position among shrink-0 siblings in the same column, so
            reordering these three blocks changes layout ORDER only, not
            the sizing math.
        */}
        {/*
            PILLS ("Frequent actions" + screen cards) -- now first.

            2026-09-07 -- FOUND ON A SHORT REAL-CHROME WINDOW (404px inner
            height, verified via real Chrome, not just the pane): this band
            was `shrink-0` -- always rendered at its full natural height,
            never allowed to shrink. On a tall viewport that is harmless
            (COMPOSER_MAX_HEIGHT_VH's 62vh comfortably covers pills +
            control strip + input). At 404px, 62vh is only 250px, and a full
            ranked-pill list alone needs more than that -- with the outer
            wrapper's `overflow-visible` (needed so the composer can grow
            upward past its resting height) and no shrink on this band, the
            excess didn't scroll or clip: it pushed the control strip and
            the input band DOWN, off the bottom of the composer's own box,
            past where any visible border implied they'd be. Measured live:
            the control strip and the Send button rendered 117-220px below
            the composer's own reported bottom edge -- present in the DOM,
            reachable by scrolling the page, but invisible in the space the
            card visually implies they occupy.

            Fixed the same way `conversation` already handles its own
            unbounded growth two lines below: `min-h-0` (overrides the
            content-based automatic minimum size `overflow:visible` flex
            items get by default, letting this band actually shrink instead
            of forcing an overflow) + `overflow-y-auto` (once shrunk below
            its natural height, extra pills scroll internally) + an explicit
            `maxHeight` safety cap, so a very short viewport still reserves
            real room for the control strip and input below it rather than
            letting pills claim unbounded space before those bands get a
            look-in. PillStrip.tsx itself is untouched -- this only bounds
            its container.
        */}
        {/* R80 PART 4 -- PART 1 (TOP THIRD): Frequent actions. Undocked,
            this is `flex-1 basis-0` (one exact third, scrolling inside
            itself); docked, it keeps the shrink + 40vh cap the comment
            above describes, because there it shares a content-sized box
            with a real Task Master pane rather than owning a third of a
            pane of its own. */}
        {pills && (
          <div
            className={
              dockedOverTaskMaster
                ? "min-h-0 shrink overflow-y-auto px-3 pb-1.5 pt-2"
                : "min-h-0 h-1/3 shrink-0 grow-0 overflow-y-auto px-3 pb-1.5 pt-2"
            }
            style={
              dockedOverTaskMaster
                ? { borderColor: "var(--color-ct-border)", maxHeight: "40vh" }
                : { borderColor: "var(--color-ct-border)" }
            }
          >
            {pills}
          </div>
        )}

        {/*
            CONVERSATION -- grows upward as the chain is worked.

            2026-09-07 -- same class of bug as the pills band's own fix
            above, found the same way (a live repro + geometric bounding-rect
            checks, not a screenshot glance): `flex-1` alone does not cap this
            band's growth, because the outer wrapper's height is "auto,
            clamped by max-height" rather than a fixed value flex-1 siblings
            can divide up predictably -- when this band's own content (the
            project-picker chip list, in the repro that found this) is large
            enough, it can grow past where CONTROL STRIP/INPUT below it are
            laid out, genuinely overlapping them rather than being clipped by
            its own overflow-y-auto (that only clips once ITS box is
            correctly bounded, which is exactly what was missing). Same fix:
            an explicit `maxHeight` safety cap, so this band shrinks and
            scrolls internally instead of encroaching on the bands after it.
        */}
        {/* R80 PART 4 -- PART 2 (MIDDLE THIRD): "MODE PILLS / OPTION
            SELECTION CHAIN". Both halves of that live here: the
            `conversation` slot (M24Shell renders ChainOptionsPanel into
            it -- the actual option-selection chips: New | Expiring soon |
            Open ...) and the ControlStrip below it (the chain's own
            segments plus All modules / Tasks / Back / Home / Reset). They
            were two independent siblings of the pills and input bands
            before; they are one band now so the middle third is a single,
            coherent third rather than two competing ones. Undocked this
            wrapper is `flex-1 basis-0` (one exact third); docked it keeps
            the old auto/shrink behaviour so nothing about the
            float-over-Task-Master case changes. */}
        <div
          className={
            dockedOverTaskMaster
              ? "flex min-h-0 flex-col"
              : "flex min-h-0 h-1/3 shrink-0 grow-0 flex-col overflow-hidden"
          }
        >
          {conversation && (
            <div
              className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
              style={dockedOverTaskMaster ? { maxHeight: "40vh" } : undefined}
            >
              {conversation}
            </div>
          )}

          {/* CONTROL STRIP -- and the one instruction, rendered here only.
              Moved to sit just above the input, per the frozen mock. */}
          <div className="relative shrink-0 border-t" style={{ borderColor: "var(--color-ct-border)" }}>
            <ControlStrip
              chain={chain}
              onCutFrom={onCutFrom}
              onSegmentClick={onSegmentClick}
              onBack={onBack}
              onHome={onHome}
              onReset={onReset}
              prompt={instruction}
              loaded={loaded}
              allModulesExpanded={allModulesExpanded}
              onToggleAllModules={onToggleAllModules}
              onToggleTasks={onToggleTasks}
              tasksExpanded={tasksExpanded}
            />
          </div>
        </div>

        {/* R80 PART 4 -- PART 3 (BOTTOM THIRD): the chat box (input,
            Send, worked examples, attach). Undocked it is `flex-1
            basis-0` like its two siblings and scrolls internally;
            docked it stays `shrink-0`, its long-standing behaviour. */}
        <div
          className={
            dockedOverTaskMaster
              ? "shrink-0 px-3 pb-2.5 pt-1"
              : "min-h-0 h-1/3 shrink-0 grow-0 overflow-y-auto px-3 pb-2.5 pt-1"
          }
        >
          {/* R67 C-04: the chain's scalar values, as labelled fields, beside
              the thing they are inputs to. */}
          {fieldsSlot && <div className="mb-1 flex flex-wrap items-end gap-3">{fieldsSlot}</div>}
          {/* R67 A-19 -- INK VERSUS GREY, BY CLASS.
              The colour of the text in this box is what tells a person whether
              there is anything in it: a placeholder is a suggestion, a value is
              something that will be SENT. That distinction used to rest on the
              content alone -- one inline `color`, applied to both -- so a
              prefilled sentence and an example of a sentence looked identical,
              in a box whose button writes to a project. The ink and the grey
              are separate classes now, and neither depends on what the words
              happen to say. */}
          {/* 2026-09-07 -- VISUAL-ONLY re-skin to match the frozen mock
              (owner direction: existing wiring stays, only the drawing
              changes). The mock's Send is a small circular icon INSET in
              the textarea's own bottom-right corner, not a separate full-
              width worded button below it. Every prop this button reads
              (onSubmit/sendDisabled/busy/sendLabel/instruction) and every
              accessibility guarantee (A-19's "the reason is the whole of
              the accessible name", A-18's 44px minimum) is unchanged --
              only HOW it is drawn moves. The button's own box stays a real
              44x44 hit area (`style={{width:44,height:44}}` below); a
              smaller `<span>` inside it draws the compact circle the mock
              shows, so the VISIBLE affordance is small while the CLICKABLE
              one is not -- a strictly visual change, not a touch-target
              regression. `pr-9` on the textarea keeps typed text from
              running underneath it, the same reason the mock's own
              textarea carries extra right padding. */}
          <div className="relative">
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => {
                lastTypedRef.current = e.target.value;
                onChange(e.target.value);
              }}
              onFocus={(e) => {
                // A-19 -- A VALUE THAT ARRIVED ON ITS OWN IS SELECTED ON FOCUS,
                // "so it reads as typed text". A chain replay or a prefill puts a
                // whole sentence in the box that the user did not write; selecting
                // it says, in the one convention every text field already uses,
                // "this is a draft you may replace" -- the next keystroke
                // replaces it instead of appending to the middle of someone
                // else's sentence. A value the user typed themselves is never
                // touched: their cursor is theirs.
                if (value && value !== lastTypedRef.current) e.currentTarget.select();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !sendDisabled && onSubmit) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              rows={2}
              placeholder={placeholder}
              aria-label="Describe the task"
              className="w-full resize-none bg-transparent pr-9 text-[13px] leading-relaxed text-[var(--color-ct-navy)] outline-none placeholder:text-[var(--color-ct-muted)]"
              style={{ minHeight: 46 }}
            />
            <button
              type="button"
              data-testid="composer-send"
              onClick={onSubmit}
              disabled={sendDisabled}
              aria-busy={busy}
              aria-label={sendLabel}
              title={instruction || sendLabel}
              className="absolute bottom-0 right-0 flex items-center justify-center disabled:opacity-40"
              style={{ width: 44, height: 44 }}
            >
              <span
                aria-hidden
                className="flex items-center justify-center rounded-lg"
                style={{
                  // WS-G tokens, no new colour: navy on saffron. White on
                  // saffron was the contrast failure this replaces.
                  width: 26,
                  height: 26,
                  background: "var(--color-ct-saffron)",
                  color: "var(--color-ct-navy)",
                }}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
              </span>
            </button>
          </div>
          {examples && (
            <div className="pt-0.5 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
              {examples}
            </div>
          )}
          {/* 2026-09-07 -- Send moved into the textarea's own corner (above),
              matching the mock, so this row is now attach + the failure
              line only. A-10's actual rule -- the failure is immediately
              visible, in the reading path, not floating disconnected from
              the control it explains -- still holds: it is still directly
              below the input, still `min-h-0`/no fixed height so it never
              gets clipped, just no longer sharing a row with a button that
              no longer lives here. `flex-wrap` stays as the safety net from
              the same fix this comment used to document -- now doing far
              less work, since attach is a compact icon rather than a full
              worded button, but still correct if a very long error message
              and a very narrow viewport ever coincide. */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {attachSlot}
            {/* THE FOOTER LINE IS EMPTY UNLESS SOMETHING FAILED. The next
                question lives in the strip; printing it here as well was how
                one state came to show two contradicting sentences. */}
            {errorMessage && (
              <p role="alert" className="min-w-0 flex-1 text-[11.5px]" style={{ color: "var(--color-veri-status-late)" }}>
                {errorMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
