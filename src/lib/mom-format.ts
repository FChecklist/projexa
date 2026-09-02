// R67 lane D22 (item D-63, rec R-203): the MoM screen's defaults and its
// share summary.
//
// THE POINT OF THE DEFAULTS: a site coordination meeting is minuted while it
// runs, on a phone, by someone who is also listening. Opening /moms/new to a
// blank Title and a blank Date & time -- with the primary button disabled until
// both are filled -- costs two interactions before a single word of what was
// said can be typed. Defaulting both means the form is savable on arrival and
// one typed word is enough to make the title specific.
//
// THE POINT OF THE SUMMARY: a bare wa.me link tells the recipient nothing about
// what they are being sent. One line ahead of it -- what, which meeting, when,
// how much is outstanding -- is what makes it worth opening.

/** Pure: "<project> - site coordination", the default title for a new meeting. */
export function defaultMeetingTitle(projectName: string | null | undefined): string {
  const name = (projectName ?? "").trim();
  return name ? `${name} - site coordination` : "Site coordination";
}

/**
 * Pure: `now` rounded UP to the next half hour, as a `datetime-local` input
 * value ("2026-08-28T10:30").
 *
 * Local time, not UTC, deliberately: this feeds an <input type="datetime-local">,
 * which is always interpreted in the browser's own zone -- formatting it as UTC
 * would show a meeting at the wrong hour to everyone outside it.
 */
export function nextHalfHourLocalInput(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  const rounded = Math.ceil(minutes / 30) * 30;
  d.setMinutes(rounded);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Pure: the one-line summary that goes ahead of a share link, e.g.
 * "MoM - Weekly Site Coordination - 28 Aug 2026 - 4 actions".
 *
 * `formattedDate` is passed in rather than computed here so this stays pure and
 * so the whole app keeps ONE date formatter (format-date.ts), which is pinned
 * to a fixed locale and time zone for hydration safety.
 */
export function meetingShareSummary(title: string, formattedDate: string, actionCount: number): string {
  const actions = `${actionCount} ${actionCount === 1 ? "action" : "actions"}`;
  return `MoM - ${title.trim()} - ${formattedDate} - ${actions}`;
}

// ─── R67 lane D22 (item D-75, rec R-287): Publish & Lock, demoted and honest ─
//
// WHAT WAS WRONG: "Publish & Lock" was the only saffron button on a meeting
// that had just been opened -- so the loudest control on the screen was the
// irreversible one, sitting above minutes that were still empty. Publishing
// locks the minutes AND the share link server-side (veri-meeting-service's
// assertEditable), and there is no unpublish anywhere in the codebase.
//
// It is now a secondary control that says why it cannot be pressed while there
// is nothing to publish, and asks before it fires. The strings live here, next
// to the other MoM copy, so the screen and its test read the same sentence.

/** The publish control's label when it is ready to be pressed. */
export const PUBLISH_LOCK_LABEL = "Publish & Lock";

/**
 * The label AND the reason, in one string, when there are no minutes.
 *
 * One string rather than a label plus a tooltip: a disabled control's reason
 * has to be readable without hovering (and on a phone there is no hover at
 * all), which is the same disabled-with-reason convention correction C-11
 * named as this app's good pattern.
 */
export const PUBLISH_LOCK_NO_MINUTES_LABEL = "Publish & Lock (no minutes yet)";

/** The inline confirm sentence -- inline, never a modal (the global no-dialogs rule). */
export const PUBLISH_LOCK_CONFIRM = "Locks the minutes and share link; cannot be undone";

/** Pure: what the publish control reads, given the minutes as they stand. */
export function publishLockLabel(minutes: string | null | undefined): string {
  return (minutes ?? "").trim() ? PUBLISH_LOCK_LABEL : PUBLISH_LOCK_NO_MINUTES_LABEL;
}

/** Pure: may this meeting be published yet? Whitespace is not minutes. */
export function canPublishMeeting(minutes: string | null | undefined): boolean {
  return (minutes ?? "").trim().length > 0;
}
