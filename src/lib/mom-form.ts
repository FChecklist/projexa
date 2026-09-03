// R67 D-18. The decision logic behind the MoM create form, pulled out of the
// component so it can be unit tested directly.
//
// This mirrors the convention compliance-tracker's own services already use
// (see construction-boq-service.test.ts's header: "the pure helpers extracted
// from ..."), and it is load-bearing here for a second, measured reason: in
// this repo's test environment (bun + @happy-dom/global-registrator + React
// 19) a simulated keystroke into a CONTROLLED text input does not reach
// React's onChange at all. Verified rather than assumed -- React's onClick,
// onInput, onFocus/onBlur, <select> onChange and checkbox onChange all fire
// under fireEvent, while onChange on <input type="text">/<textarea> never
// does, with or without the value tracker cleared and whichever of
// fireEvent.change / fireEvent.input / a raw dispatchEvent is used. So the
// "type a title, watch the primary rename itself" half of this form's rule
// is asserted here, against the same function the component calls, instead
// of being left untested behind a harness limitation.
export const TITLE_REQUIRED_MESSAGE = "Enter a meeting title, e.g. Weekly Site Coordination";

export type MeetingDraft = {
  title: string;
  scheduledAt: string; // datetime-local wall clock, no zone
  meetingType: string;
  attendees: string[];
  attendeeDraft: string;
  agenda: string;
};

/**
 * The fields the Save button names when it refuses. The order is the reading
 * order of the form, so "Save (Title, Date & time)" matches what the eye
 * scans. /labour/new already ships this convention as "Save (Name, Daily
 * Rate)".
 */
export function missingMeetingFields(draft: Pick<MeetingDraft, "title" | "scheduledAt">): string[] {
  return [
    ...(draft.title.trim() ? [] : ["Title"]),
    ...(draft.scheduledAt ? [] : ["Date & time"]),
  ];
}

/** One agenda item per line; blank lines and stray indentation are dropped. */
export function parseAgendaLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Commits the attendee the user has half-typed. A trailing comma is the
 * separator, not part of the name; a duplicate is a no-op rather than a
 * second identical chip.
 */
export function addAttendee(attendees: readonly string[], raw: string): string[] {
  const value = raw.trim().replace(/,+$/, "").trim();
  if (!value || attendees.includes(value)) return [...attendees];
  return [...attendees, value];
}

export type CreateMeetingBody = {
  title: string;
  scheduledAt: string;
  projectId: string;
  meetingType: string;
  attendees: string[];
  agenda: string[];
};

/**
 * The POST body. `toIso` converts the typed wall clock into a real instant in
 * the organisation's zone -- injected rather than imported so this function
 * stays pure and the zone rule is tested once, in org-time.test.ts.
 *
 * A name still sitting in the attendee input when Save is pressed is
 * included: losing it silently is the same class of fault as a form that
 * discards a half-typed field on submit.
 */
export function buildCreateMeetingBody(
  draft: MeetingDraft,
  projectId: string,
  toIso: (wallClock: string) => string
): CreateMeetingBody {
  return {
    title: draft.title.trim(),
    scheduledAt: toIso(draft.scheduledAt),
    projectId,
    meetingType: draft.meetingType,
    attendees: addAttendee(draft.attendees, draft.attendeeDraft),
    agenda: parseAgendaLines(draft.agenda),
  };
}
