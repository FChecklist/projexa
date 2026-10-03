// LOCAL-FIRST shell, "platform and knowledge" group: the ONE reader behind Wiki, Meetings, Projects, Workspace and Settings.
//
// WHAT THE LAPTOP HOLDS (compliance-tracker drizzle/0643 + 0683/0684, the sync service's own column lists):
//   wiki_pages  {id, parent_page_id, slug, title, content, version}                     (not archived pages; scope: org AND project)
//   meetings    {id, title, scheduled_at, duration_minutes, recurrence_rule, created_at} (pms_meetings; NOT the MoM `meeting_minutes` kind)
//   project     {id, name, description, is_active, status, access_level, health_status, lead_user_id, start_date, target_date,
//                rollup_percentage, created_at, updated_at, project_value*, vat_rate_percent*, retention_percent*}  (* null below the money rank)
//   organisation kinds (role-gated by the server): org_people, boq_categories, currencies (see org-masters.ts)
//
// WHAT IT DOES NOT HOLD (never invented here): a meeting's agenda, participants and outcomes; who last edited a wiki page; a project's
// contract value, earned value or "% complete" (the server computes those from the BOQ; the laptop never recomputes money or progress);
// the organisation's name or slug; members' e-mail addresses; KPIs (`kpi_entries` is left out of the sync on purpose), the Knowledge Base
// (org-wide pages: no kind) and GRC (no kind): those three are not registered, so the shell's generic "not on this laptop yet" answers.
//
// Replica rows are UNTRUSTED input: filter field by field, never cast. A field the sync service hid for this person's role
// (DoneMarker.hiddenFields) is dropped here even if a row still carries it. Nothing here calls the server and nothing writes.

import type { ShellData } from "../context";
import { loadOrgLocal } from "../../org-local";
import { asRecord, readKind } from "./documents-records";
import { boqCategoryPicker, moneyMasters, type Currency } from "./org-masters";

export const WIKI_KIND = "wiki_pages";
export const MEETINGS_KIND = "meetings";
export const PROJECT_KIND = "project";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const wholeNumber = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const money = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// â”€â”€â”€ shared shapes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ListData<T> =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number | null; rows: T[] };

export type ObjectData<T> =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; syncedAt: number | null; item: T };

async function readRows<T>(
  data: ShellData,
  projectId: string,
  kind: string,
  toRow: (v: unknown, hidden: ReadonlySet<string>) => T | null
): Promise<{ synced: boolean; syncedAt: number | null; rows: T[] }> {
  const read = await readKind(data, projectId, kind);
  if (!read.synced) return { synced: false, syncedAt: null, rows: [] };
  const rows: T[] = [];
  for (const raw of read.rows) {
    const row = toRow(raw, read.hidden);
    if (row) rows.push(row);
  }
  return { synced: true, syncedAt: read.syncedAt, rows };
}

async function loadList<T>(data: ShellData, projectId: string | null, kind: string, toRow: (v: unknown, hidden: ReadonlySet<string>) => T | null, order: (a: T, b: T) => number): Promise<ListData<T>> {
  if (!projectId) return { state: "no_project" };
  const { synced, syncedAt, rows } = await readRows(data, projectId, kind, toRow);
  if (!synced) return { state: "not_synced", projectId };
  return { state: "local", projectId, syncedAt, rows: rows.sort(order) };
}

/** One row by id. `projectId` is where the URL said it lives; without it every project on this laptop is searched in order. */
async function loadObject<T extends { id: string }>(data: ShellData, id: string, projectId: string | null, kind: string, toRow: (v: unknown, hidden: ReadonlySet<string>) => T | null): Promise<ObjectData<T>> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const { synced, syncedAt, rows } = await readRows(data, candidate, kind, toRow);
    if (!synced) continue;
    anySynced = true;
    const item = rows.find((r) => r.id === id);
    if (item) return { state: "local", projectId: candidate, syncedAt, item };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

// â”€â”€â”€ wiki â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type LocalWikiPage = { id: string; slug: string | null; title: string; content: string | null; version: number | null };

export function toLocalWikiPage(v: unknown, hidden: ReadonlySet<string> = new Set()): LocalWikiPage | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = text(o.id);
  const title = text(o.title);
  if (!id || !title) return null;
  const field = <T>(key: string, read: (x: unknown) => T): T | null => (hidden.has(key) ? null : read(o[key]));
  return { id, title, slug: field("slug", text), content: field("content", (x) => (typeof x === "string" ? x : null)), version: field("version", wholeNumber) };
}

const byTitle = (a: { title: string; id: string }, b: { title: string; id: string }) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

export const loadWikiList = (data: ShellData, projectId: string | null) => loadList(data, projectId, WIKI_KIND, toLocalWikiPage, byTitle);
export const loadWikiObject = (data: ShellData, id: string, projectId: string | null) => loadObject(data, id, projectId, WIKI_KIND, toLocalWikiPage);

// â”€â”€â”€ meetings (the scheduling module, pms_meetings) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type LocalMeeting = { id: string; title: string; scheduledAt: string | null; durationMinutes: number | null; recurrenceRule: string | null; createdAt: string | null };

export function toLocalMeeting(v: unknown, hidden: ReadonlySet<string> = new Set()): LocalMeeting | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = text(o.id);
  const title = text(o.title);
  if (!id || !title) return null;
  const field = <T>(key: string, read: (x: unknown) => T): T | null => (hidden.has(key) ? null : read(o[key]));
  return {
    id,
    title,
    scheduledAt: field("scheduled_at", text),
    durationMinutes: field("duration_minutes", wholeNumber),
    recurrenceRule: field("recurrence_rule", text),
    createdAt: field("created_at", text),
  };
}

/** Latest meeting first; a meeting without a date last; ties by title so the order never depends on how IndexedDB returned the rows. */
export function byScheduledDesc(a: LocalMeeting, b: LocalMeeting): number {
  if (a.scheduledAt === b.scheduledAt) return byTitle(a, b);
  if (a.scheduledAt === null) return 1;
  if (b.scheduledAt === null) return -1;
  return a.scheduledAt < b.scheduledAt ? 1 : -1;
}

export const loadMeetingsList = (data: ShellData, projectId: string | null) => loadList(data, projectId, MEETINGS_KIND, toLocalMeeting, byScheduledDesc);
export const loadMeetingObject = (data: ShellData, id: string, projectId: string | null) => loadObject(data, id, projectId, MEETINGS_KIND, toLocalMeeting);

// â”€â”€â”€ projects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type LocalProject = {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  health: string | null;
  startDate: string | null;
  targetDate: string | null;
  /** The server's stored value; null below the money rank (the server nulls it) or when not carried. Never computed here. */
  projectValue: number | null;
};

/** A `project` row as THE project `projectId`, or null (the sync scope is one row: the project itself; a row about another id is junk). */
export function toLocalProject(v: unknown, projectId: string, hidden: ReadonlySet<string> = new Set()): LocalProject | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = text(o.id);
  const name = text(o.name);
  if (!id || !name || id !== projectId) return null;
  const field = <T>(key: string, read: (x: unknown) => T): T | null => (hidden.has(key) ? null : read(o[key]));
  return {
    id,
    name,
    description: field("description", text),
    status: field("status", text),
    health: field("health_status", text),
    startDate: field("start_date", text),
    targetDate: field("target_date", text),
    projectValue: field("project_value", money),
  };
}

export type ProjectEntry = { id: string; name: string; /** null: this project's own details have not been copied (only its name is known). */ project: LocalProject | null };
export type ProjectsListData = { state: "no_project" } | { state: "local"; entries: ProjectEntry[]; currency: Currency | null };

/** Every project this person has on the laptop; details from the `project` kind where it was copied to the end, else the name alone. */
export async function loadProjectsList(data: ShellData): Promise<ProjectsListData> {
  if (data.projects.length === 0) return { state: "no_project" };
  const entries: ProjectEntry[] = [];
  for (const p of data.projects) {
    const { synced, rows } = await readRows(data, p.id, PROJECT_KIND, (v, hidden) => toLocalProject(v, p.id, hidden));
    entries.push({ id: p.id, name: rows[0]?.name ?? p.name, project: synced ? rows[0] ?? null : null });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  // The base currency is read only to PRINT a stored amount; nothing is converted or computed.
  const masters = entries.some((e) => e.project?.projectValue != null) ? await moneyMasters({ userId: data.userId, idb: data.idb }) : null;
  return { state: "local", entries, currency: masters?.state === "local" ? masters.base : null };
}

// â”€â”€â”€ workspace (/workspace/:id: one project, the sections this ROLE may see) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type WorkspaceData =
  | { state: "not_found"; projectId: string }
  | { state: "local"; projectId: string; name: string; project: LocalProject | null };

export async function loadWorkspace(data: ShellData, projectId: string): Promise<WorkspaceData> {
  const known = data.projects.find((p) => p.id === projectId);
  // A project this person does not have on the laptop is "not found" (the server says the same for a project it will not show them).
  if (!known) return { state: "not_found", projectId };
  const { rows } = await readRows(data, projectId, PROJECT_KIND, (v, hidden) => toLocalProject(v, projectId, hidden));
  return { state: "local", projectId, name: rows[0]?.name ?? known.name, project: rows[0] ?? null };
}

// â”€â”€â”€ settings (read-only: the account, and the organisation's own masters the role may read) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type Master<T> = { state: "local"; value: T } | { state: "not_allowed" | "not_synced" };
export type TeamMember = { id: string; name: string; role: string | null; active: boolean };
export type SettingsData = {
  name: string | null;
  email: string | null;
  role: string | null;
  orgId: string | null;
  projectCount: number;
  currency: Master<Currency | null>;
  categories: Master<string[]>;
  team: Master<TeamMember[]>;
};

export async function loadSettings(data: ShellData): Promise<SettingsData> {
  const access = { userId: data.userId, idb: data.idb };
  const masters = await moneyMasters(access);
  const picker = await boqCategoryPicker(access);
  const people = await loadOrgLocal("org_people", access);
  const team: Master<TeamMember[]> =
    people.state !== "local"
      ? { state: people.state }
      : {
          state: "local",
          value: people.rows
            .flatMap((row) => {
              const name = text(row.name);
              return name ? [{ id: row.id, name, role: text(row.role), active: row.is_active !== false }] : [];
            })
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        };
  return {
    name: data.name,
    email: data.email,
    role: data.role,
    orgId: data.orgId,
    projectCount: data.projects.length,
    currency: masters.state === "local" ? { state: "local", value: masters.base } : { state: masters.state },
    categories: picker.state === "local" ? { state: "local", value: picker.options.map((o) => o.label) } : { state: picker.state },
    team,
  };
}
