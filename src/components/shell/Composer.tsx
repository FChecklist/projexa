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

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
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
};

export function Composer({
  chain,
  onCutFrom,
  onSegmentClick,
  onHome,
  onReset,
  instruction,
  sendLabel = "Send",
  canSend,
  errorMessage,
  busy = false,
  loaded,
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
}: ComposerProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef ?? ownRef;
  // R67 A-19 -- WHAT THE USER LAST TYPED, so a value that arrived some other
  // way can be told apart from one they wrote. See the focus handler below.
  const lastTypedRef = useRef("");

  // The box sizes ITSELF. This is the whole of the sizing logic, and it is
  // deliberately not user-controllable.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [value, taRef]);

  const sendDisabled = !canSend || busy || !onSubmit;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end px-3 pb-3"
      style={{ maxHeight: `${COMPOSER_MAX_HEIGHT_VH}vh` }}
    >
      {/* R67 C-14: the message region, above the box and outside it. It
          renders nothing at all when there is nothing to say, so it costs the
          input band no height on a phone. */}
      {messages}
      {/* FULL WIDTH ACROSS BOTH PANES. Not confined to one pane. */}
      <div
        className="pointer-events-auto relative flex w-full flex-col overflow-visible rounded-xl border shadow-sm"
        style={{
          minHeight: COMPOSER_RESTING_HEIGHT,
          maxHeight: `${COMPOSER_MAX_HEIGHT_VH}vh`,
          background: "#fff",
          borderColor: "var(--color-ct-border2)",
        }}
      >
        {/* 1. CONTROL STRIP -- and the one instruction, rendered here only. */}
        <div className="relative shrink-0 border-b" style={{ borderColor: "var(--color-ct-border)" }}>
          <ControlStrip
            chain={chain}
            onCutFrom={onCutFrom}
            onSegmentClick={onSegmentClick}
            onHome={onHome}
            onReset={onReset}
            prompt={instruction}
            loaded={loaded}
          />
        </div>

        {/* 2. CONVERSATION -- grows upward as the chain is worked. */}
        {conversation && <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{conversation}</div>}

        {/* 3. PILLS */}
        {pills && (
          <div className="shrink-0 px-3 pb-1.5 pt-1" style={{ borderColor: "var(--color-ct-border)" }}>
            {pills}
          </div>
        )}

        {/* 4. INPUT -- real height, generous padding. Not a single line. */}
        <div className="shrink-0 px-3 pb-2.5 pt-1">
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
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-[var(--color-ct-navy)] outline-none placeholder:text-[var(--color-ct-muted)]"
            style={{ minHeight: 46 }}
          />
          {examples && (
            <div className="pt-0.5 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
              {examples}
            </div>
          )}
          {/* A-10 -- ONE ROW: the failure line sits immediately left of the
              button, on the same line, at a 44 px minimum height. It used to
              float above the textarea, where the box's own growth could push
              it out of the reading path at exactly the moment it mattered. */}
          <div className="mt-1 flex min-h-[44px] items-center gap-2">
            {attachSlot}
            {/* THE FOOTER LINE IS EMPTY UNLESS SOMETHING FAILED. The next
                question lives in the strip; printing it here as well was how
                one state came to show two contradicting sentences. */}
            {errorMessage && (
              <p role="alert" className="min-w-0 text-[11.5px]" style={{ color: "var(--color-veri-status-late)" }}>
                {errorMessage}
              </p>
            )}
            {/* The spinner sits BESIDE the button, so the label can stay put. */}
            {busy && (
              <span
                aria-hidden
                className="ml-auto inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: "var(--color-ct-border2)", borderTopColor: "transparent" }}
              />
            )}
            {/* NO FAIL-AFTER-CLICK: when the action cannot succeed the button
                is disabled and the reason is the strip's own sentence, carried
                here as the tooltip and the accessible name rather than printed
                a second time in grey. */}
            {/* R67 A-19 -- THE LABEL IS THE WHOLE OF THE ACCESSIBLE NAME.
                It used to be "<label> — <the strip's question>" whenever Send
                was disabled, so the button announced one sentence and read
                another, and the reason was said twice on one screen: once in
                the strip and once here. A-19 puts the reason INSIDE the label
                ("Send (pick a project, say what you need)") and leaves nothing
                beside the button to disagree with it. The strip's question
                stays as the hover title, which A-18 already settled is
                supplementary text and never the only label. */}
            <button
              type="button"
              onClick={onSubmit}
              disabled={sendDisabled}
              aria-busy={busy}
              aria-label={sendLabel}
              title={instruction || sendLabel}
              className={`${busy ? "" : "ml-auto "}rounded-lg px-3 text-[12px] font-medium disabled:opacity-40`}
              style={{
                // WS-G tokens, no new colour: navy on saffron. White on saffron
                // was the contrast failure this replaces.
                background: "var(--color-ct-saffron)",
                color: "var(--color-ct-navy)",
                minHeight: 44,
                minWidth: 44,
              }}
            >
              {sendLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
