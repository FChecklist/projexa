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
//     into this repo.
//
//  2. NO MODE ROW, so no `onModeChange` prop -- see ControlStrip.tsx.
//
//  3. ONE INSTRUCTION. The kit printed a grey `disabledReason` beside the Send
//     button while the strip printed its own fixed "Select a module to begin",
//     so a blocked user read two different sentences about one state. There is
//     now a single `instruction`, rendered ONCE in the strip and reused
//     verbatim as the Send button's tooltip and accessible name. A real
//     failure (`errorMessage`) is a different thing and still gets its own
//     line, in red, with role="alert".
//
//  4. SEND IS DRIVEN BY `canSend`, not by the textarea being non-empty. The
//     kit disabled Send whenever the box was empty, which made the pill path
//     -- pick a module, press Send, no typing required -- silently impossible.
//     The caller decides what is submittable and says why in one string.

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
   * THE ONE STATE-DERIVED INSTRUCTION (A-01). Rendered in the strip, and
   * reused verbatim as the Send button's tooltip -- never printed twice.
   */
  instruction: string;
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
  canSend,
  errorMessage,
  busy = false,
  loaded,
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
  textareaRef,
}: ComposerProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef ?? ownRef;

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
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3"
      style={{ maxHeight: `${COMPOSER_MAX_HEIGHT_VH}vh` }}
    >
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
          {errorMessage && (
            <p role="alert" className="pb-1 text-[11.5px]" style={{ color: "var(--color-veri-status-late)" }}>
              {errorMessage}
            </p>
          )}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !sendDisabled && onSubmit) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            placeholder={placeholder}
            aria-label="Describe the task"
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none"
            style={{ color: "var(--color-ct-navy)", minHeight: 46 }}
          />
          {examples && (
            <div className="pt-0.5 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
              {examples}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            {attachSlot}
            {/* NO FAIL-AFTER-CLICK: when the action cannot succeed the button
                is disabled and the reason is the strip's own sentence, carried
                here as the tooltip and the accessible name rather than printed
                a second time in grey. */}
            <button
              type="button"
              onClick={onSubmit}
              disabled={sendDisabled}
              aria-busy={busy}
              aria-label={canSend ? "Send" : `Send — ${instruction}`}
              title={instruction}
              className="ml-auto rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
              style={{ background: "var(--color-ct-saffron)" }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
