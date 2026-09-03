"use client";

// R67 WS-C (C-09) -- BAND 2, RENDERED.
//
// A PROJEXA component, never a kit one (D-09). The kit's Composer declares a
// CONVERSATION band and hands it a ReactNode; what goes in it is the
// product's, not the shell's.
//
// WHAT IT DRAWS, IN ORDER:
//   1. the turns so far -- the user's own sentence as a right-hand bubble,
//      then the receipts, notes and gaps the product answered with;
//   2. "Sending…", immediately, so a press of Send is never met with silence;
//   3. the LIVE card, whatever it is right now (a proposal, a picker, an
//      answer), passed in as children.
//
// TWO RULES IT ENFORCES.
//
// A. WHAT THE USER SAID STAYS ON SCREEN. R-218's finding is that Send emptied
//    the box and left nothing behind, so "what did I just ask for" had no
//    answer. A turn is appended, never substituted.
// B. A TURN FROM BEFORE A PROJECT SWITCH IS GREYED AND SAYS SO. Rendering
//    "record 50% on excavation" at full strength after the user has moved to
//    another project is how a right sentence gets read against a wrong
//    project.

import type { ReactNode } from "react";
import { isStale, staleNote, type ConversationTurn } from "@/lib/conversation";

export type ConversationBandProps = {
  turns: readonly ConversationTurn[];
  /** The project the composer is on NOW, for the staleness check. */
  currentProjectId: string | null;
  /** Names for the ids the turns carry, so "was for" can name a project. */
  projectNameById: (id: string) => string | null;
  /** True while a request is in flight: the immediate answer to a Send. */
  sending: boolean;
  /** Open a receipt's or a gap's destination. Opening a screen is a read. */
  onOpen: (href: string) => void;
  onDismissTurn?: (id: string) => void;
  /** The live card: a proposal, a picker, an answer. */
  children?: ReactNode;
};

export function ConversationBand({
  turns,
  currentProjectId,
  projectNameById,
  sending,
  onOpen,
  onDismissTurn,
  children,
}: ConversationBandProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {turns.map((turn) => {
        const stale = isStale(turn, currentProjectId);
        const note = stale ? staleNote(turn.projectId ? projectNameById(turn.projectId) : null) : null;
        const dim = { opacity: stale ? 0.55 : 1 };

        if (turn.kind === "said") {
          return (
            <p key={turn.id} className="flex justify-end" style={dim}>
              <span
                className="max-w-[80%] rounded-lg px-2 py-1 text-[12px]"
                style={{ background: "var(--color-ct-cloud)", color: "var(--color-ct-navy)" }}
              >
                {turn.text}
                {note && (
                  <span className="ml-1.5 text-[10.5px]" style={{ color: "var(--color-ct-muted)" }}>
                    — {note}
                  </span>
                )}
              </span>
            </p>
          );
        }

        const tone =
          turn.kind === "receipt" ? "var(--color-ct-navy)" : turn.kind === "gap" ? "var(--color-ct-navy)" : "var(--color-ct-muted)";

        return (
          <p key={turn.id} className="flex flex-wrap items-center gap-2 text-[12px]" style={{ ...dim, color: tone }}>
            <span>{turn.text}</span>
            {note && (
              <span className="text-[10.5px]" style={{ color: "var(--color-ct-muted)" }}>
                {note}
              </span>
            )}
            {"href" in turn && turn.href && (
              <button type="button" className="veri-view-tab" onClick={() => onOpen(turn.href!)}>
                {("hrefLabel" in turn && turn.hrefLabel) || "Open"}
              </button>
            )}
            {onDismissTurn && (
              <button
                type="button"
                className="veri-icon-btn"
                style={{ width: 16, height: 16, fontSize: 10 }}
                aria-label={`Dismiss: ${turn.text}`}
                onClick={() => onDismissTurn(turn.id)}
              >
                ×
              </button>
            )}
          </p>
        );
      })}

      {/* IMMEDIATE. A Send that is met with nothing at all is the defect
          R-218 records; this line costs one render and removes it. */}
      {sending && (
        <p role="status" className="text-[12px]" style={{ color: "var(--color-ct-muted)" }}>
          Sending…
        </p>
      )}

      {children}
    </div>
  );
}
