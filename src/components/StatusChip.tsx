// R67 D-16 -- a status is a GLYPH AND A WORD, never colour alone.
//
// Three reasons this is not a `<Badge variant="default">`:
//
//  1. Colour alone is not a status. A colour-blind user, a greyscale print
//     and a screenshot pasted into a report all lose it. Every chip here
//     carries the word as well, and the glyph differs in SHAPE (filled vs
//     hollow), not only in hue.
//  2. Saffron is this product's single primary-action colour and rose is
//     reserved for late/error. Spending either on "this meeting is
//     published" devalues both -- after which nothing on the screen reads as
//     urgent because everything does.
//  3. D-09: no kit release in this programme. This is projexa-local on
//     purpose, using the kit's own status tokens rather than new colours,
//     so a later shared chip can absorb it without a palette change.
//
// The tones are the kit's own token set (veridian-ui-kit/src/tokens/
// globals.css): --color-veri-status-done is sage, --color-veri-status-context
// is the dusty blue used for selection/context, and the neutral tone is the
// ordinary muted grey.

const TONE_COLOR: Record<StatusChipTone, string> = {
  done: "var(--color-veri-status-done)",
  context: "var(--color-veri-status-context)",
  neutral: "var(--color-ct-muted)",
};

export type StatusChipTone = "done" | "context" | "neutral";

export function StatusChip({
  label,
  filled,
  tone = "neutral",
}: {
  label: string;
  /** Filled circle = a terminal/committed state; hollow = still open. */
  filled: boolean;
  tone?: StatusChipTone;
}) {
  const color = TONE_COLOR[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap" style={{ color }}>
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={filled ? { backgroundColor: color } : { border: `1.5px solid ${color}` }}
      />
      {label}
    </span>
  );
}
