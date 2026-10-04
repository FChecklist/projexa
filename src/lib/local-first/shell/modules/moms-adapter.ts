// LOCAL-FIRST shell, Minutes of Meetings (/moms, /moms/:id): the project's MoMs, read from the laptop's own copy.
//
// The online MoM screens read compliance.veri_meetings (/veri-meetings), and /moms/:id is a veri_meetings id. The sync carries those rows
// as the `meeting_minutes` kind (compliance-tracker drizzle/0643, records_core): exactly
//   id, title, meeting_type, scheduled_at, status, published_at, agenda, minutes, attendee_count, created_at
// (the attendee list itself is NOT sent -- it can hold e-mail addresses -- only how many were invited; no AI output is sent).
// The `meetings` kind is a different table (pms_meetings, the scheduling module) and is not read here.
//
// NOT ON THE LAPTOP (GAPS): attendee names, action items and their tasks, the meeting number (systemId), the AI summary / key decisions,
// share links, and the PDF export. The object screen says so rather than leaving holes that look like "none".

import type { ShellData } from "../context";
import { asRecord, readKind } from "./documents-records";

export const MEETING_MINUTES_KIND = "meeting_minutes";

export type LocalMom = {
  id: string;
  projectId: string;
  title: string;
  meetingType: string | null;
  scheduledAt: string | null;
  status: string | null;
  publishedAt: string | null;
  /** One item per line, as the online form takes it; null when not carried. */
  agenda: string[] | null;
  minutes: string | null;
  attendeeCount: number | null;
  createdAt: string | null;
  waiting: boolean;
};

export type MomsListData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number | null; rows: LocalMom[] };

export type MomObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; syncedAt: number | null; mom: LocalMom };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function agendaOf(v: unknown): string[] | null {
  if (typeof v === "string") return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Non-text items are skipped, never stringified into something the person did not write.
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  return null;
}

/** A published MoM is locked online (details and minutes); the laptop never offers to amend one. */
export const isPublished = (m: Pick<LocalMom, "status" | "publishedAt">): boolean => m.status === "published" || m.publishedAt !== null;

/** A replica row as a MoM of `projectId`, or null when it does not look like one. */
export function toLocalMom(v: unknown, projectId: string, hidden: ReadonlySet<string> = new Set(), waitingIds: ReadonlySet<string> = new Set()): LocalMom | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = text(o.id);
  const title = text(o.title);
  if (!id || !title) return null;
  const field = <T>(key: string, read: (x: unknown) => T): T | null => (hidden.has(key) ? null : read(o[key]));
  const count = field("attendee_count", (x) => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null));
  return {
    id,
    projectId,
    title,
    meetingType: field("meeting_type", text),
    scheduledAt: field("scheduled_at", text),
    status: field("status", text),
    publishedAt: field("published_at", text),
    agenda: field("agenda", agendaOf),
    minutes: field("minutes", (x) => (typeof x === "string" ? x : null)),
    attendeeCount: count,
    createdAt: field("created_at", text),
    waiting: waitingIds.has(id),
  };
}

async function readProjectMoms(data: ShellData, projectId: string): Promise<{ synced: boolean; syncedAt: number | null; moms: LocalMom[] }> {
  const read = await readKind(data, projectId, MEETING_MINUTES_KIND);
  if (!read.synced) return { synced: false, syncedAt: null, moms: [] };
  const moms: LocalMom[] = [];
  for (const row of read.rows) {
    const mom = toLocalMom(row, projectId, read.hidden, read.waitingIds);
    if (mom) moms.push(mom);
  }
  return { synced: true, syncedAt: read.syncedAt, moms };
}

/** Latest meeting first; a meeting without a date last. */
export function bySchedule(a: LocalMom, b: LocalMom): number {
  if (a.scheduledAt === b.scheduledAt) return a.title.localeCompare(b.title);
  if (a.scheduledAt === null) return 1;
  if (b.scheduledAt === null) return -1;
  return a.scheduledAt < b.scheduledAt ? 1 : -1;
}

export async function loadMomsList(data: ShellData, projectId: string | null): Promise<MomsListData> {
  if (!projectId) return { state: "no_project" };
  const { synced, syncedAt, moms } = await readProjectMoms(data, projectId);
  if (!synced) return { state: "not_synced", projectId };
  return { state: "local", projectId, syncedAt, rows: moms.sort(bySchedule) };
}

export async function loadMomObject(data: ShellData, id: string, projectId: string | null): Promise<MomObjectData> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const { synced, syncedAt, moms } = await readProjectMoms(data, candidate);
    if (!synced) continue;
    anySynced = true;
    const mom = moms.find((m) => m.id === id);
    if (mom) return { state: "local", projectId: candidate, syncedAt, mom };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}
