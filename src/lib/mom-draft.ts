// R67 lane D22 (item D-58, rec R-187): the minutes survive leaving the page.
//
// THE REAL SITUATION THIS IS FOR: minutes are typed DURING a meeting, on a
// laptop that gets closed, a phone that rings, a browser tab that is switched
// away from to check the programme. Losing twenty minutes of typed minutes
// because someone navigated is the single most expensive failure this screen
// can have, and the create screen had no persistence of any kind.
//
// localStorage, not sessionStorage (unlike footer-message.ts, which is
// deliberately session-scoped): a draft must survive closing the tab and
// coming back, which is exactly what sessionStorage does not do. Keyed per
// project so two meetings drafted for two projects never overwrite each other.
//
// Every accessor is try/catch'd -- storage throws outright in some privacy
// modes, and a blocked draft must degrade to "no draft", never to a crash in
// the middle of a meeting.

export type MoMDraftActionItem = { title: string; assigneeUserId: string | null; assigneeName: string | null; dueDate: string };

export type MoMDraft = {
  title: string;
  scheduledAt: string;
  attendees: string[];
  agenda: string[];
  minutes: string;
  actionItems: MoMDraftActionItem[];
  /** ISO timestamp of the last autosave -- what "Draft saved 10:42" is read from. */
  savedAt: string;
};

const KEY_PREFIX = "veri.mom.draft.";

function key(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

/** Pure: is there anything in this draft worth offering to restore? */
export function draftHasContent(draft: Omit<MoMDraft, "savedAt">): boolean {
  return (
    draft.title.trim().length > 0 ||
    draft.minutes.trim().length > 0 ||
    draft.attendees.length > 0 ||
    draft.agenda.some((a) => a.trim().length > 0) ||
    draft.actionItems.some((a) => a.title.trim().length > 0)
  );
}

/** Pure: "10:42" from an ISO timestamp, or null when it cannot be read. Pinned to 24h so it never reads "10:42 am" in one locale and "10:42" in another. */
export function draftSavedAtLabel(savedAt: string | null | undefined): string | null {
  if (!savedAt) return null;
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function saveMoMDraft(projectId: string, draft: Omit<MoMDraft, "savedAt">): string | null {
  const savedAt = new Date().toISOString();
  try {
    localStorage.setItem(key(projectId), JSON.stringify({ ...draft, savedAt }));
    return savedAt;
  } catch {
    // A lost draft indicator is survivable; a crash mid-meeting is not.
    return null;
  }
}

export function loadMoMDraft(projectId: string): MoMDraft | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MoMDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      scheduledAt: typeof parsed.scheduledAt === "string" ? parsed.scheduledAt : "",
      attendees: Array.isArray(parsed.attendees) ? parsed.attendees.filter((a): a is string => typeof a === "string") : [],
      agenda: Array.isArray(parsed.agenda) ? parsed.agenda.filter((a): a is string => typeof a === "string") : [],
      minutes: typeof parsed.minutes === "string" ? parsed.minutes : "",
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((a) => ({
            title: typeof a?.title === "string" ? a.title : "",
            assigneeUserId: typeof a?.assigneeUserId === "string" ? a.assigneeUserId : null,
            assigneeName: typeof a?.assigneeName === "string" ? a.assigneeName : null,
            dueDate: typeof a?.dueDate === "string" ? a.dueDate : "",
          }))
        : [],
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function clearMoMDraft(projectId: string): void {
  try {
    localStorage.removeItem(key(projectId));
  } catch {
    // Same reasoning as saveMoMDraft.
  }
}
