// R67 WS-G (R-214 / R-227 / R-260). THE status chip for PROJEXA -- one
// component, one map, glyph + word + token colour, and nothing else in this
// app is allowed to invent its own.
//
// WHAT IT REPLACES. Before this, a status was drawn three different ways on
// three different screens: shadcn <Badge variant="destructive"> (bright red)
// on the BOQ list and the attendance log, <Badge variant="default"> (the
// saffron primary fill) on "active"/"published", and the kit's StatusBadge on
// permits. So the same idea -- "this row is fine" / "this row needs you" --
// arrived in three unrelated colours, one of which was the brand's primary
// ACTION colour, which made a passive state look clickable. R-260's fix is
// this single map.
//
// THE THREE RULES IT ENFORCES, structurally rather than by convention:
//   1. COLOUR IS NEVER THE ONLY CARRIER. Every chip is a glyph AND a word.
//      ~8% of men have a colour-vision deficiency (M24); a red dot alone is
//      not a status to them, and it is not a status in a greyscale print
//      either.
//   2. ROSE IS RESERVED FOR LATE AND ERROR. "superseded" and "draft" are
//      grey, not red -- a superseded revision is history, not a fault. The
//      map below is the only place that can grant rose.
//   3. SAFFRON IS NEVER A STATUS. Saffron means "the primary action on this
//      screen", exactly one per screen. No status maps to it.
//
// D-09: the kit's own StatusBadge is deliberately NOT used and NOT edited --
// it paints the WORD in the kit's four TINTS, which measure 2.4:1-3.4:1 as
// text on cream and so fail AA for the word. This component uses the darker
// --status-*-text tones declared in src/app/globals.css and asserted in
// src/lib/theme/contrast.test.ts. Same four hues, readable.
import type { ComponentType } from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** The four M24 status tones, plus waiting and neutral. */
export type StatusTone = "needs-you" | "running" | "waiting" | "done" | "late" | "neutral";

/**
 * Every status word this app renders as a chip. Adding one here is the only
 * way to get a chip; there is no free-text escape hatch, which is what stops
 * the ad-hoc red/green classes growing back.
 */
export type SemanticStatus =
  | "draft"
  | "published"
  | "current"
  | "superseded"
  | "active"
  | "inactive"
  | "blocked"
  | "running"
  | "done"
  | "late"
  | "needs-you"
  | "waiting";

type ToneStyle = {
  /** Stable key for tests and for callers that need to name a glyph without rendering one. */
  glyphKey: string;
  icon: ComponentType<{ className?: string }>;
  /** A CSS custom property, so light and dark are both handled by globals.css. */
  colorVar: string;
};

// The SHAPES must differ, not only the tone strings. This map is the whole of
// rule 1 ("colour is never the only carrier"), and it is only true if a reader
// who sees no colour at all can still tell two chips apart: needs-you and
// neutral both drew a plain lucide `Circle` at first, so on the permits list a
// permit with no expiry date ("-") and one expiring in 12 days carried an
// identical mark. The word still separated them, but the second cue -- the one
// this component exists for -- was not there. status-pill.test.ts asserts the
// six entries resolve to six DISTINCT icon components, not six distinct keys.
export const TONE_STYLE: Record<StatusTone, ToneStyle> = {
  // Clay. "Your move." The dot is FILLED (CircleDot, a ring around a solid
  // centre), because it is asking for something -- against neutral's empty
  // outline circle, which is not.
  "needs-you": { glyphKey: "needs-you", icon: CircleDot, colorVar: "var(--status-needs-you-text)" },
  // Dusty blue. In flight, nobody has to do anything yet.
  running: { glyphKey: "running", icon: Loader2, colorVar: "var(--status-running-text)" },
  // Grey clock. Someone else's move.
  waiting: { glyphKey: "waiting", icon: Clock, colorVar: "var(--status-neutral-text)" },
  // Sage tick.
  done: { glyphKey: "done", icon: CheckCircle2, colorVar: "var(--status-done-text)" },
  // Rose triangle. The ONLY loud tone, and only for late and error.
  late: { glyphKey: "late", icon: AlertTriangle, colorVar: "var(--status-late-text)" },
  // Grey outline circle -- the "○" of "○ superseded".
  neutral: { glyphKey: "neutral", icon: Circle, colorVar: "var(--status-neutral-text)" },
};

/**
 * The single map. A status has exactly one tone and exactly one word, and
 * both are decided here rather than at each call site.
 *
 * Note what is NOT rose: draft, superseded and inactive. A superseded BOQ
 * revision used to render as a bright red badge, which read as "something is
 * wrong with this document" when it means "a newer revision exists".
 */
export const STATUS_MAP: Record<SemanticStatus, { tone: StatusTone; word: string }> = {
  draft: { tone: "neutral", word: "draft" },
  published: { tone: "done", word: "published" },
  current: { tone: "done", word: "current" },
  superseded: { tone: "neutral", word: "superseded" },
  active: { tone: "done", word: "active" },
  inactive: { tone: "neutral", word: "inactive" },
  // Blocked is the error class, not the "needs you" class: the work cannot
  // proceed, which is what rose is for. "needs-you" means it CAN proceed and
  // is waiting on this user.
  blocked: { tone: "late", word: "blocked" },
  running: { tone: "running", word: "running" },
  done: { tone: "done", word: "done" },
  late: { tone: "late", word: "late" },
  "needs-you": { tone: "needs-you", word: "needs you" },
  waiting: { tone: "waiting", word: "waiting" },
};

/** True when `value` is a status this app knows how to draw. */
export function isSemanticStatus(value: string): value is SemanticStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_MAP, value);
}

/**
 * Normalises the shapes the backends actually send -- `half_day`,
 * `HALF_DAY`, `Half Day` -- to the one this map keys on. Anything unknown
 * comes back null so the caller shows the raw word in the neutral tone
 * rather than a chip that silently means the wrong thing.
 */
export function toSemanticStatus(value: string | null | undefined): SemanticStatus | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return isSemanticStatus(key) ? key : null;
}

export type StatusPillProps = {
  /** The tone to paint. Callers that hold a semantic status use <StatusPill>. */
  tone: StatusTone;
  /** The word. Never omitted -- a chip with no word is a colour, and a colour is not a status. */
  label: string;
  className?: string;
};

/**
 * Tone-first chip, for callers that have already derived a tone from
 * something that is not a status word (a day count, a variance sign).
 * R-214: 12px is the FLOOR for a status chip, not a suggestion.
 */
export function StatusPillTone({ tone, label, className }: StatusPillProps) {
  const { icon: Icon } = TONE_STYLE[tone];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[12px] leading-none whitespace-nowrap", className)}
      style={{ color: TONE_STYLE[tone].colorVar }}
    >
      {/* aria-hidden: the glyph is redundant WITH the word, which is the
          point. A screen reader reads the word; a colour-blind reader sees
          the shape; everyone else gets both. */}
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/**
 * Status-first chip. Give it a semantic status and it decides tone, glyph and
 * word from STATUS_MAP.
 *
 * `label` overrides only the WORD (e.g. an attendance row wants "half day"
 * drawn in the needs-you tone); it can never override the tone, because that
 * is exactly the drift this component exists to stop.
 */
export function StatusPill({ status, label, className }: { status: SemanticStatus; label?: string; className?: string }) {
  const entry = STATUS_MAP[status];
  return <StatusPillTone tone={entry.tone} label={label ?? entry.word} className={className} />;
}

/**
 * The safe front door for a status string that came off an API. Known words
 * get their real tone; anything else is drawn neutral with the raw word
 * shown, so an unrecognised backend state is visible rather than guessed at.
 */
export function StatusPillFor({ status, className }: { status: string | null | undefined; className?: string }) {
  const semantic = toSemanticStatus(status);
  if (semantic) return <StatusPill status={semantic} className={className} />;
  return <StatusPillTone tone="neutral" label={(status ?? "").replace(/[_]+/g, " ") || "unknown"} className={className} />;
}
