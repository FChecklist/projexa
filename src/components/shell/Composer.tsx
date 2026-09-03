"use client";

// PROJEXA'S FORK of @fchecklist/veridian-ui-kit/shell/Composer.tsx (kit
// 0.7.0, commit 8134e07), taken under programme decision D-09. The kit source
// is not on this machine and is not published, so a behaviour change is made
// by forking this one file; HistoryDrop and the whole chain API are still
// imported from the kit, and only ControlStrip resolves to PROJEXA's fork
// beside this file.
//
// FOUR CHANGES. The first two are R67 WS-G; the third is R67 C-04 (see the
// `fieldsSlot` prop below); the fourth is R67 C-10 -- the kit's HistoryDrop
// is no longer rendered, because this screen had TWO controls named History
// and the composer's own showed a sessionStorage list of chains while the
// Task Master's tab showed real rows. Per correction C-03 only that
// duplicate-control merge stands: the "the drop covers the tabs" claim, its
// z-index fix and its acceptance clause were withdrawn and none of that is
// implemented here.
//
// 1. THE SEND BUTTON WAS WHITE ON SAFFRON -- 2.60:1, a WCAG AA failure on the
//    single most-clicked control in the product (R-197 / R-260). It keeps the
//    saffron fill and takes navy text: 5.55:1, no new colour. It cannot
//    inherit the app's --primary-foreground fix, because it sets its own
//    colour inline rather than going through the shadcn Button variant.
//
// 2. THE DISABLED REASON WAS EASY TO MISS AND SOMETIMES ABSENT (G-04 /
//    R-231). The kit renders it at 11px, on the LEFT of the row after
//    attachSlot -- which is the bottom-left corner of the viewport, exactly
//    where Next.js parks its development badge, so during local work the one
//    sentence explaining why Send will not fire sat behind an overlay. Worse,
//    there was a state with NO instruction at all: the button is also
//    disabled when the textarea is empty, and in that state disabledReason
//    was undefined, so the user got a dead control and no words. Now the
//    reason renders at 12px immediately to the LEFT OF SEND, inside the same
//    right-aligned group, and `emptyInputReason` supplies the missing state's
//    sentence -- so there is exactly one instruction for every state in which
//    the button cannot fire, and never two.
//
// ------------------------- the kit's own notes ---------------------------
// M24-A -- THE CHAT BOX IS THE PRODUCT, NOT A TOOLBAR.
//
// EVERYTHING LIVES INSIDE THE BOX, top to bottom:
//   1. CONTROL STRIP  - Mode | chain with the (x) | HISTORY  HOME  (reset)
//   2. CONVERSATION   - grows upward as the chain is worked
//   3. PILLS          - the ranked set
//   4. INPUT          - text + attach, with real height, not a single line
//
// NO DRAGGING, NO RESIZE HANDLE, NO PIN. M24: "window management is load
// MOVED, not load removed. The box must size itself."

import { useEffect, useRef, type ReactNode } from "react";
import {
  COMPOSER_MAX_HEIGHT_VH,
  COMPOSER_RESTING_HEIGHT,
  type Chain,
  type ChainMode,
} from "@fchecklist/veridian-ui-kit/shell";
import { ControlStrip } from "./ControlStrip";
import { composerSendState } from "@/lib/composer-send-state";

export type ComposerProps = {
  chain: Chain;
  onModeChange: (mode: ChainMode) => void;
  onCutFrom: (index: number) => void;
  onSegmentClick?: (index: number) => void;
  onHome: () => void;
  onReset: () => void;

  /**
   * R67 C-10: the HISTORY control no longer opens a drop of its own. Two
   * controls on this screen were named History -- this one and the Task
   * Master's own tab -- and the duplicate is merged into the tab, which reads
   * REAL compliance.pipeline_tasks rows rather than a sessionStorage list of
   * chains. The word stays on the strip; it now focuses that tab.
   */
  onHistory: () => void;

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
  /** 3. PILLS -- the ranked set. */
  pills?: ReactNode;

  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  /** Disabled reason, shown in words. Empty/undefined means "not blocked by the caller". */
  disabledReason?: string;
  /**
   * R67 G-04: the sentence for the one state the kit left silent -- the
   * button is disabled because nothing has been typed. A default is supplied
   * so a caller cannot accidentally reintroduce the wordless dead control.
   */
  emptyInputReason?: string;
  /**
   * R67 G-04: the kit disabled Send whenever the textarea was empty, FULL
   * STOP -- while the placeholder in that same state read "Press send to run
   * this, or add detail first…". So once a module pill had been picked, the
   * composer told the user to press a button it had disabled. That is worse
   * than a missing instruction: it is a wrong one. When the caller already
   * has something runnable armed (PROJEXA: a pending functionId), it says so
   * here and an empty input is a legitimate submission.
   */
  allowEmptySubmit?: boolean;
  placeholder?: string;
  attachSlot?: ReactNode;
  /**
   * R67 C-04 (a third fork change): BAND 4'S LABELLED SCALAR FIELDS.
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
};

export function Composer({
  chain,
  onModeChange,
  onCutFrom,
  onSegmentClick,
  onHome,
  onReset,
  onHistory,
  messages,
  conversation,
  pills,
  value,
  onChange,
  onSubmit,
  disabledReason,
  emptyInputReason = "Type what you need, then press Send.",
  allowEmptySubmit = false,
  placeholder = "Describe what you need, or pick a module above.",
  attachSlot,
  fieldsSlot,
}: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // The box sizes ITSELF. This is the whole of the sizing logic, and it is
  // deliberately not user-controllable.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [value]);

  // ONE INSTRUCTION PER STATE, derived from the SAME evaluation that disables
  // the button -- so the two cannot drift apart and leave a dead control with
  // no words beside it. The rule lives in src/lib/composer-send-state.ts,
  // where it is unit-tested; the caller's own reason wins there, because it
  // is the more specific fact ("Sending…", or the server's own refusal).
  const blockedByCaller = Boolean(disabledReason);
  const { canSubmit, reason } = composerSendState({
    disabledReason,
    value,
    allowEmptySubmit,
    emptyInputReason,
    hasSubmitHandler: Boolean(onSubmit),
  });

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
        {/* 1. CONTROL STRIP */}
        <div className="relative shrink-0 border-b" style={{ borderColor: "var(--color-ct-border)" }}>
          <ControlStrip
            chain={chain}
            onModeChange={onModeChange}
            onCutFrom={onCutFrom}
            onSegmentClick={onSegmentClick}
            onHistory={onHistory}
            onHome={onHome}
            onReset={onReset}
          />
          {/* R67 C-10: the kit's HistoryDrop used to hang here. It is gone --
              not for any z-index reason (correction C-03 WITHDREW that claim
              and its fix), but because two controls on this screen were named
              History and one of them showed a sessionStorage list of chains
              while the other showed real pipeline_tasks rows. The word on the
              strip now focuses the Task Master's own History tab. */}
        </div>

        {/* 2. CONVERSATION -- grows upward as the chain is worked. */}
        {conversation && <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{conversation}</div>}

        {/* 3. PILLS -- arrive and leave with the composer. */}
        {pills && (
          <div className="shrink-0 px-3 pb-1.5 pt-1" style={{ borderColor: "var(--color-ct-border)" }}>
            {pills}
          </div>
        )}

        {/* 4. INPUT -- real height, generous padding. Not a single line. */}
        <div className={`shrink-0 px-3 pb-2.5 pt-1${blockedByCaller ? " veri-composer-disabled" : ""}`}>
          {/* R67 C-04: the chain's scalar values, as labelled fields, beside
              the thing they are inputs to. */}
          {fieldsSlot && <div className="mb-1 flex flex-wrap items-end gap-3">{fieldsSlot}</div>}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && canSubmit && onSubmit) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            placeholder={placeholder}
            aria-label="Describe the task"
            aria-describedby={reason ? "veri-composer-send-reason" : undefined}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none"
            style={{ color: "var(--color-ct-navy)", minHeight: 46 }}
          />
          <div className="mt-1 flex items-center gap-2">
            {attachSlot}
            {/* NO FAIL-AFTER-CLICK: when the action cannot succeed the button
                is disabled and the reason is IMMEDIATELY BESIDE IT, in words,
                at 12px, inside this right-aligned group -- not in the
                bottom-left corner where the dev badge sits. role="status" so
                a screen reader hears it change without the focus moving. */}
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {reason && (
                <span
                  id="veri-composer-send-reason"
                  role="status"
                  className="truncate text-[12px]"
                  style={{ color: "var(--status-needs-you-text)" }}
                >
                  {reason}
                </span>
              )}
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                // R67 WS-G: navy on saffron, 5.55:1. Was white, 2.60:1.
                className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
                style={{ background: "var(--color-ct-saffron)", color: "var(--color-ct-navy)" }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
