"use client";

// R67 WS-A (A-01) -- PROJEXA'S FORK of the kit's shell/Composer.
//
// LEFT SCREEN COMPLETION, 2026-09-14 -- owner directive (compiled by the
// orchestrating session from several live messages; see that task's own
// prompt for the full quotes): the left panel is now EXACTLY TWO BOXES OF
// EQUAL HEIGHT. Box 1 ("Left Screen Completion" -- see
// LeftScreenCompletion.tsx) is the 7-control nav (Modules/Tasks/Frequent
// Action/Reports/Dashboard/Home/Back) plus whichever view's own content is
// active; Box 2 is the plain chat box (textarea, Send, attach). This
// replaces the previous THREE unequal bands (R80 PART 4: "Frequent
// actions" / "Mode pills, option chain" / chat), and with them the whole
// docked-over-Task-Master overlay mechanism (`dockedOverTaskMaster`,
// `COMPOSER_MAX_HEIGHT_VH`, the `pointer-events-none` growth trick) --
// there is no longer a separate, always-reserved Task Master pane above
// this component for anything to float over: Tasks is one of Box 1's own
// 7 views now (see M24Shell.tsx's `activeLeftView`), and this component
// always renders in normal flow, filling its share of the shared card.
//
// THE FORKED ControlStrip IS NO LONGER MOUNTED HERE. Box 1 owns the
// chain-sentence/"Loaded from history" banner and the nav row now (see
// LeftScreenCompletion.tsx, which reuses ControlStrip's own words and
// markup conventions in simplified form) -- mounting the old ControlStrip
// here too would put two navigation rows, including two different-looking
// Back/Home controls, on one screen, which is exactly the duplicate-control
// defect this codebase has repeatedly treated as a real bug (see this
// file's own R67 history below). `chain`/`onCutFrom`/`onSegmentClick`/
// `onBack`/`onHome`/`onReset`/`loaded`/`allModulesExpanded`/
// `onToggleAllModules`/`onToggleTasks`/`tasksExpanded`/`dockedOverTaskMaster`
// stay in ComposerProps, all optional, so every test written against the
// pre-existing prop surface keeps compiling without change; none of them do
// anything in this file any more.
//
// EVERYTHING ELSE THIS FORK CHANGED FROM THE KIT COPY IS UNCHANGED BY THIS
// PASS, and still applies inside Box 2:
//
//  1. ONE INSTRUCTION. `instruction` is rendered once, as the Send button's
//     own tooltip/accessible name -- never printed a second time.
//
//  2. SEND IS DRIVEN BY `canSend`, not by the textarea being non-empty, so
//     the pill path (pick a module, press Send, no typing required) works.
//
//  3. THE BUTTON IS NAMED FOR WHAT IT WILL DO (A-10): "Save progress",
//     "Ask", "Run", or "Send" -- and the label never changes to "Sending...";
//     a spinner sits beside it instead.
//
//  4. NAVY ON SAFFRON (A-10, WS-G tokens). White on saffron was the
//     contrast failure; navy already in the palette fixes it.
//
//  5. THE REASON IS IN THE BUTTON'S NAME (A-19), and INK VERSUS GREY ARE
//     CLASSES, NOT CONTENT.
//
//  6. R67 C-14 (WS-C, kept -- see `messages` below): A SHELL MESSAGE
//     REGION, above the box and outside it.
//
//  7. R67 C-04 (WS-C, kept -- see `fieldsSlot` below): BAND 4'S LABELLED
//     SCALAR FIELDS, for a chain step whose answer is a number or a date.

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import type { Chain } from "@fchecklist/veridian-ui-kit/shell";

export type ComposerProps = {
  /**
   * LEFT SCREEN COMPLETION, 2026-09-14 -- all optional now, and unused by
   * this file's own render: Box 1 (LeftScreenCompletion.tsx, mounted by
   * M24Shell.tsx via the `pills` slot below) owns the chain sentence and the
   * nav row that used to live here as the forked ControlStrip. Kept on the
   * type, not removed, purely so a caller/test written against the
   * pre-7-view prop surface keeps compiling unchanged -- see this file's
   * own header for the full reasoning.
   */
  chain?: Chain;
  onCutFrom?: (index: number) => void;
  onSegmentClick?: (index: number) => void;
  onBack?: () => void;
  onHome?: () => void;
  onReset?: () => void;

  /**
   * THE ONE STATE-DERIVED INSTRUCTION (A-01/A-10). Reused verbatim as the
   * Send button's tooltip -- never printed twice. Empty when the sentence is
   * complete: there is no next question then, and the button's own name
   * says what will happen.
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
  /** Unused here now (see the top-of-file note) -- Box 1 renders the
   *  "Loaded from history" banner. Kept optional for prop-surface stability. */
  loaded?: {
    from: string | null;
    pinned: boolean;
    onTogglePin: () => void;
  } | null;
  /** Unused here now -- see the top-of-file note. */
  allModulesExpanded?: boolean;
  onToggleAllModules?: () => void;
  onToggleTasks?: () => void;
  tasksExpanded?: boolean;
  /** Unused here now -- there is no longer a Task Master pane to float
   *  over; this component always renders in normal flow. Kept optional for
   *  prop-surface stability, same as the fields above. */
  dockedOverTaskMaster?: boolean;

  /**
   * R67 C-14: THE SHELL MESSAGE REGION, above the box.
   *
   * The spec's FOOTER MESSAGE AREA. It sits OUTSIDE the bordered composer and
   * directly above it, because it is the shell's voice rather than the
   * conversation's: a receipt for something a page's own form saved, or the
   * sentence for a failure nobody on site can fix. Box 2 is where the
   * composer answers for what IT did; this is where the product answers for
   * everything else, and the two are deliberately not the same surface.
   */
  messages?: ReactNode;
  /**
   * BOX 2's OWN VOICE, 2026-09-14 -- a pending verdict, an answer, module
   * leaves/"which project" chips (all still computed by M24Shell.tsx's
   * `optionLevel`/`notice`/`answer`/`pendingVerdict`, unchanged). Rendered
   * above the textarea: it is what a Send on THIS box just produced, or
   * what finishing the sentence still needs, so it belongs with the box
   * that produces it -- not with Box 1's navigation.
   */
  conversation?: ReactNode;
  /** BOX 1 -- the whole of LeftScreenCompletion, assembled by the caller. */
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
   * the INPUT band beside the thing it is an input to. Rendered above the
   * textarea so the label is read before the box.
   */
  fieldsSlot?: ReactNode;
  /** Lets the shell put the cursor in the box (reset, "Other…", prefill). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /**
   * MEASURED, NOT GUESSED (2026-09-07 origin; still real after the 2-box
   * redesign -- AppShell.tsx's `composerReserveExtra` is now inert while
   * `taskMasterExpanded` is permanently false, but the measurement itself
   * is harmless to keep reporting and a future caller may still want it).
   */
  onHeightChange?: (px: number) => void;
};

export function Composer({
  instruction,
  sendLabel = "Send",
  canSend,
  errorMessage,
  busy = false,
  messages,
  conversation,
  pills,
  examples,
  value,
  onChange,
  onSubmit,
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
  // real root, not a proxy for it.
  const rootRef = useRef<HTMLDivElement>(null);

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

  // The textarea sizes ITSELF, same mechanism as before the 2-box redesign
  // (see this file's own git history for the two live bugs this exact
  // double-effect shape already fixed: a stale ResizeObserver-only
  // measurement, and a transitional too-narrow width mid-relayout).
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
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col px-3 pb-3">
      {/* R67 C-14: the message region, above the box and outside it. It
          renders nothing at all when there is nothing to say. */}
      {messages}

      {/* THE ONE SHARED CARD (AppShell.tsx's ADDENDUM 2 origin) -- now split
          into exactly two equal-height boxes, per the owner's own words
          ("MAKE BOTH TOP LEFT BOX AND BOTTOM LEFT BOX OF EQUAL SIZES"). Both
          children are `flex-1` with no `basis` override, i.e. an honest 50/50
          split of whatever height this card has -- no `h-1/3`-style rigid
          fraction (see this repo's own R80 Part 4 history for why a rigid
          split was already found to be wrong once: real content needs differ
          per band, and a `flex-1` split still lets one box's own internal
          `overflow-y-auto` absorb the difference instead of overflowing). */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
        style={{ borderColor: "var(--color-ct-border2)", background: "#fff" }}
      >
        {/* BOX 1 (TOP HALF) -- LEFT SCREEN COMPLETION. Entirely assembled by
            the caller (M24Shell.tsx passes the whole of LeftScreenCompletion
            here) -- this file only reserves an equal-height, independently
            scrolling box for it. Renders nothing (and claims no height) on a
            caller that supplies none, same graceful-absence pattern every
            other optional slot in this file already uses. */}
        {pills && (
          <div
            className="min-h-0 flex-1 overflow-y-auto border-b"
            style={{ borderColor: "var(--color-ct-border)" }}
            data-testid="composer-box1"
          >
            {pills}
          </div>
        )}

        {/* BOX 2 (BOTTOM HALF) -- THE CHAT BOX: conversation (a pending
            verdict, an answer, module leaves/"which project" chips),
            fieldsSlot, the bordered write/upload/submit box, worked
            examples and the failure line. */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2.5 pt-2"
          data-testid="composer-box2"
        >
          {conversation && <div className="pb-1.5">{conversation}</div>}

          {/* R67 C-04: the chain's scalar values, as labelled fields, beside
              the thing they are inputs to. Deliberately OUTSIDE the bordered
              "chat box" below. */}
          {fieldsSlot && <div className="mb-1 flex flex-wrap items-end gap-3">{fieldsSlot}</div>}

          {/* OWNER FIX, 2026-09-14 -- "the bottom left box is the chat box,
              which should be empty, where user can write and submit /
              upload and submit." The bordered write/upload/submit box,
              unchanged from before the 2-box redesign. */}
          <div
            className="rounded-lg border"
            style={{ borderColor: "var(--color-ct-border2)", background: "#fff", padding: "6px 8px" }}
          >
            <div className="relative">
              <textarea
                ref={taRef}
                value={value}
                onChange={(e) => {
                  lastTypedRef.current = e.target.value;
                  onChange(e.target.value);
                }}
                onFocus={(e) => {
                  // A-19 -- A VALUE THAT ARRIVED ON ITS OWN IS SELECTED ON
                  // FOCUS, "so it reads as typed text".
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
                    // WS-G tokens, no new colour: navy on saffron.
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
            {attachSlot && <div className="mt-1 flex flex-wrap items-center gap-2">{attachSlot}</div>}
          </div>

          {/* Worked examples -- deliberately OUTSIDE the bordered box above:
              a hint about what to type, not part of what gets submitted. */}
          {examples && (
            <div className="pt-1 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
              {examples}
            </div>
          )}
          {/* THE FOOTER LINE IS EMPTY UNLESS SOMETHING FAILED. */}
          {errorMessage && (
            <p role="alert" className="mt-1 text-[11.5px]" style={{ color: "var(--color-veri-status-late)" }}>
              {errorMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
