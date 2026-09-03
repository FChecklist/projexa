"use client";

// R67 WS-C (C-05) -- HOW BAND 2 ANSWERS A QUESTION.
//
// A PROJEXA component, never a kit one (D-09).
//
// ROWS FIRST, PROSE SECOND. When someone asks "which activities are late?"
// the answer is the list; a paragraph that describes the list is the thing
// they have to read before they can act on it. So the rows are the answer,
// and the one sentence above them says what they are counting.
//
// *** EVERY ROW LOADS A CHAIN AND STOPS. *** A row is not a link into a
// mystery: it fills the strip with the sentence that reaches it and opens the
// screen. It never executes -- opening a screen is a read, and the same
// load-never-execute rule that governs history and task clicks governs this.
//
// EXACTLY ONE LINK. C-05 is explicit: an answer block carries at most one
// destination beyond its own rows, because two "see more" links in one answer
// is a choice the reader did not ask to make.

export type AnswerRow = {
  id: string;
  /** The words of the row. Already human -- never a field name or an id. */
  label: string;
  /** The right-hand figure, when the row has one: "AED 185,000", "12 days". */
  value?: string;
};

export type AnswerBlockProps = {
  /** One sentence saying what the rows are. Not a summary of them. */
  heading: string;
  rows: AnswerRow[];
  /** What to say when the answer is genuinely empty. Never "no results". */
  emptyText?: string;
  /** Loads the row's chain and opens its screen. NEVER executes. */
  onOpenRow?: (row: AnswerRow) => void;
  /** The single destination beyond the rows. */
  link?: { label: string; onOpen: () => void };
};

export function AnswerBlock({ heading, rows, emptyText, onOpenRow, link }: AnswerBlockProps) {
  return (
    <section className="text-[12px]" aria-label={heading}>
      <p style={{ color: "var(--color-ct-navy)" }}>{heading}</p>

      {rows.length === 0 ? (
        // M24: "EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN." An empty answer
        // is still an answer, and it says which question it answered.
        <p className="mt-1" style={{ color: "var(--color-ct-muted)" }}>
          {emptyText ?? "Nothing matched that on this project."}
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpenRow?.(row)}
                disabled={!onOpenRow}
                className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--color-ct-cloud)] disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1 truncate" style={{ color: "var(--color-ct-navy)" }}>
                  {row.label}
                </span>
                {row.value && (
                  <span className="shrink-0 tabular-nums" style={{ color: "var(--color-ct-muted)" }}>
                    {row.value}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {link && (
        <button type="button" onClick={link.onOpen} className="veri-view-tab mt-1.5">
          {link.label}
        </button>
      )}
    </section>
  );
}
