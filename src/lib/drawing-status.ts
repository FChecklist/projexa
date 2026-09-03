// R67 D-12 (audit R-034). One vocabulary for a drawing's status, shared by the
// register, the object page and the create form, so the three cannot end up
// calling the same state three things.
//
// Glyph AND word, never a bare colour: WS-G's rule, and the reason is that a
// colour alone is unreadable to a colour-blind user, unprintable in a mono
// register export, and meaningless to someone who has not been told the code.
// The glyphs are the ones that carry meaning without it -- a tick for the set
// you build from, an empty ring for the revision that has been replaced, a
// filled dot for the one still waiting on someone.

export const DRAWING_STATUSES = ["current", "superseded", "for_approval"] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];

/** A new upload is not the build set until someone says so. */
export const DEFAULT_DRAWING_STATUS: DrawingStatus = "for_approval";

export type StatusPresentation = { glyph: string; word: string; className: string };

const PRESENTATION: Record<DrawingStatus, StatusPresentation> = {
  // Sage tick: this is the one you build from.
  current: { glyph: "✓", word: "Current", className: "text-[color:var(--color-veri-status-done)]" },
  // Grey ring: replaced by a later revision. Present, but not the build set.
  superseded: { glyph: "○", word: "Superseded", className: "text-ct-muted" },
  // Clay dot: uploaded, still waiting on a person.
  for_approval: { glyph: "●", word: "For approval", className: "text-[color:var(--color-veri-status-needs-you)]" },
};

/**
 * A row written before D-12 has no status at all. It reads as "For approval"
 * rather than "Current": promoting every historical drawing into the build set
 * because a jsonb key was missing would be a lie with consequences on site.
 */
export function normaliseDrawingStatus(raw: unknown): DrawingStatus {
  return (DRAWING_STATUSES as readonly unknown[]).includes(raw) ? (raw as DrawingStatus) : DEFAULT_DRAWING_STATUS;
}

export function statusPresentation(raw: unknown): StatusPresentation {
  return PRESENTATION[normaliseDrawingStatus(raw)];
}

/** "✓ Current" -- the same words the export and the object header use. */
export function statusText(raw: unknown): string {
  const { glyph, word } = statusPresentation(raw);
  return `${glyph} ${word}`;
}

/** What the create form offers. 'Superseded' is not a thing you upload something AS. */
export const CREATE_STATUS_OPTIONS: { value: DrawingStatus; label: string }[] = [
  { value: "for_approval", label: "For approval" },
  { value: "current", label: "Current" },
];
