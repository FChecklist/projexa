// LOCAL-FIRST shell, cluster "site" (RFIs, submittals, punch list, site diary, FF&E): the ONE place these screens read the laptop's own
// database, and the tolerant parsers that turn a replica row into what a screen shows.
//
// WHAT THE LAPTOP HOLDS (compliance-tracker drizzle/0643, ai_work_link__records_core, snake_case keys; the same names in camelCase are
// accepted too, as in delivery-local.ts):
//   rfis         id, number, subject, question, status, ball_in_court, raised_by_id, assigned_to_id, due_date, answer, answered_by_id, answered_at, created_at
//   submittals   id, number, title, spec_section, type, status, submitted_by_id, due_date, reviewed_by_id, reviewed_at, review_comments, created_at
//   punch_list   id, number, description, location, trade, priority, status, assigned_to_id, due_date, verified_by_id, verified_at, created_by_id, created_at
//   site_diaries id, diary_date, weather, work_done, visitors, issues, instructions, material_received, labour_count, remarks, recorded_by_id, created_at
//   ffe_items    id, room_or_area, category, item_name, description, sku, quantity, lead_time_days, status, document_id, created_at,
//                unit_cost*, unit_price*, vendor_id*     (* money: NULL below the role that may see cost, named in the pull's hidden_fields)
//
// NOT ON THE LAPTOP (never invented): who raised / answered / reviewed (ids only, no names: the people master is a different kind), an FF&E
// item's dimensions, and the FF&E margin summary (a server aggregation: money is never computed on the laptop).
//
// UNTRUSTED INPUT: a row is used only when it looks like the thing (an id and the field that names it); a wrong-typed value is null,
// shown as a dash, never coerced. A field the role may not see is dropped even when a stale row still carries it.

import type { ShellData } from "../context";
import { asRecord, readKind as readRaw, type KindRead } from "./documents-records";

export const SITE_KINDS = { rfis: "rfis", submittals: "submittals", punch: "punch_list", diaries: "site_diaries", ffe: "ffe_items" } as const;

export const isTempId = (id: string): boolean => id.startsWith("local-");

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const numeric = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
};
const whole = (v: unknown): number | null => {
  const n = numeric(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const day = (v: unknown): string | null => {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const stamp = (v: unknown): string | null => {
  const s = text(v);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};

/** camelCase twin of a snake_case column. */
const camel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Reads one column of a row under either spelling; null when the role hides it. */
function reader(o: Record<string, unknown>, hidden: ReadonlySet<string>) {
  return <T>(snake: string, read: (x: unknown) => T): T | null => {
    if (hidden.has(snake) || hidden.has(camel(snake))) return null;
    const v = snake in o && o[snake] !== undefined ? o[snake] : o[camel(snake)];
    return read(v);
  };
}

type Ctx = { hidden: ReadonlySet<string>; waiting: ReadonlySet<string> };

// ─── RFIs ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type LocalRfi = {
  id: string; number: number | null; subject: string; question: string | null; status: string | null; ballInCourt: string | null;
  assignedToId: string | null; dueDate: string | null; answer: string | null; answeredAt: string | null; createdAt: string | null; waiting: boolean;
};
export function toLocalRfi(raw: unknown, ctx: Ctx): LocalRfi | null {
  const o = asRecord(raw);
  const id = o && text(o.id);
  if (!o || !id) return null;
  const f = reader(o, ctx.hidden);
  const subject = f("subject", text);
  if (!subject) return null;
  return {
    id, number: f("number", whole), subject, question: f("question", text), status: f("status", text), ballInCourt: f("ball_in_court", text),
    assignedToId: f("assigned_to_id", text), dueDate: f("due_date", day), answer: f("answer", text), answeredAt: f("answered_at", stamp),
    createdAt: f("created_at", stamp), waiting: isTempId(id) || ctx.waiting.has(id),
  };
}

// ─── submittals ─────────────────────────────────────────────────────────────────────────────────────────────────

export type LocalSubmittal = {
  id: string; number: number | null; title: string; specSection: string | null; type: string | null; status: string | null; dueDate: string | null;
  reviewedAt: string | null; reviewComments: string | null; createdAt: string | null; waiting: boolean;
};
export function toLocalSubmittal(raw: unknown, ctx: Ctx): LocalSubmittal | null {
  const o = asRecord(raw);
  const id = o && text(o.id);
  if (!o || !id) return null;
  const f = reader(o, ctx.hidden);
  const title = f("title", text);
  if (!title) return null;
  return {
    id, number: f("number", whole), title, specSection: f("spec_section", text), type: f("type", text), status: f("status", text), dueDate: f("due_date", day),
    reviewedAt: f("reviewed_at", stamp), reviewComments: f("review_comments", text), createdAt: f("created_at", stamp), waiting: isTempId(id) || ctx.waiting.has(id),
  };
}

// ─── punch list ─────────────────────────────────────────────────────────────────────────────────────────────────

export type LocalPunchItem = {
  id: string; number: number | null; description: string; location: string | null; trade: string | null; priority: string | null; status: string | null;
  assignedToId: string | null; dueDate: string | null; verifiedAt: string | null; createdAt: string | null; waiting: boolean;
};
export function toLocalPunchItem(raw: unknown, ctx: Ctx): LocalPunchItem | null {
  const o = asRecord(raw);
  const id = o && text(o.id);
  if (!o || !id) return null;
  const f = reader(o, ctx.hidden);
  const description = f("description", text);
  if (!description) return null;
  return {
    id, number: f("number", whole), description, location: f("location", text), trade: f("trade", text), priority: f("priority", text), status: f("status", text),
    assignedToId: f("assigned_to_id", text), dueDate: f("due_date", day), verifiedAt: f("verified_at", stamp), createdAt: f("created_at", stamp),
    waiting: isTempId(id) || ctx.waiting.has(id),
  };
}

// ─── site diary ─────────────────────────────────────────────────────────────────────────────────────────────────

export type LocalDiary = {
  id: string; diaryDate: string; weather: string | null; workDone: string | null; visitors: string | null; issues: string | null; instructions: string | null;
  materialReceived: string | null; labourCount: number | null; remarks: string | null; createdAt: string | null; waiting: boolean;
};
export function toLocalDiary(raw: unknown, ctx: Ctx): LocalDiary | null {
  const o = asRecord(raw);
  const id = o && text(o.id);
  if (!o || !id) return null;
  const f = reader(o, ctx.hidden);
  const diaryDate = f("diary_date", day);
  if (!diaryDate) return null;
  return {
    id, diaryDate, weather: f("weather", text), workDone: f("work_done", text), visitors: f("visitors", text), issues: f("issues", text),
    instructions: f("instructions", text), materialReceived: f("material_received", text), labourCount: f("labour_count", whole), remarks: f("remarks", text),
    createdAt: f("created_at", stamp), waiting: isTempId(id) || ctx.waiting.has(id),
  };
}

// ─── FF&E ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type LocalFfeItem = {
  id: string; itemName: string; roomOrArea: string | null; category: string | null; description: string | null; sku: string | null; quantity: number | null;
  leadTimeDays: number | null; status: string | null; createdAt: string | null;
  /** Money for the item as stored (a per-unit figure the server holds): null when unknown OR hidden for the role (see costHidden). Never computed here. */
  unitCost: number | null; unitPrice: number | null; vendorId: string | null;
  /** The role may not see cost: unitCost / unitPrice / vendorId were not sent. */
  costHidden: boolean; vendorHidden: boolean; waiting: boolean;
};
export const FFE_STATUSES = ["specified", "ordered", "received", "installed"] as const;
export function toLocalFfeItem(raw: unknown, ctx: Ctx): LocalFfeItem | null {
  const o = asRecord(raw);
  const id = o && text(o.id);
  if (!o || !id) return null;
  const f = reader(o, ctx.hidden);
  const itemName = f("item_name", text);
  if (!itemName) return null;
  const costHidden = ["unit_cost", "unit_price"].some((c) => ctx.hidden.has(c) || ctx.hidden.has(camel(c)));
  const vendorHidden = ctx.hidden.has("vendor_id") || ctx.hidden.has("vendorId");
  return {
    id, itemName, roomOrArea: f("room_or_area", text), category: f("category", text), description: f("description", text), sku: f("sku", text),
    quantity: f("quantity", numeric), leadTimeDays: f("lead_time_days", whole), status: f("status", text), createdAt: f("created_at", stamp),
    unitCost: f("unit_cost", numeric), unitPrice: f("unit_price", numeric), vendorId: f("vendor_id", text), costHidden, vendorHidden, waiting: isTempId(id) || ctx.waiting.has(id),
  };
}

// ─── loading ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ListData<T> =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number | null; rows: T[] };

export type ObjectData<T> =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; syncedAt: number | null; item: T };

function parseAll<T>(read: KindRead, parse: (raw: unknown, ctx: Ctx) => T | null): T[] {
  const ctx: Ctx = { hidden: read.hidden, waiting: read.waitingIds };
  const out: T[] = [];
  for (const raw of read.rows) {
    const item = parse(raw, ctx);
    if (item) out.push(item);
  }
  return out;
}

async function list<T>(data: ShellData, projectId: string | null, kind: string, parse: (raw: unknown, ctx: Ctx) => T | null, order: (a: T, b: T) => number): Promise<ListData<T>> {
  if (!projectId) return { state: "no_project" };
  const read = await readRaw(data, projectId, kind);
  if (!read.synced) return { state: "not_synced", projectId };
  return { state: "local", projectId, syncedAt: read.syncedAt, rows: parseAll(read, parse).sort(order) };
}

/** One row by id. `projectId` is where the URL said it lives; without it every project of the person on this laptop is searched in order. */
async function find<T extends { id: string }>(data: ShellData, id: string, projectId: string | null, kind: string, parse: (raw: unknown, ctx: Ctx) => T | null): Promise<ObjectData<T>> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const read = await readRaw(data, candidate, kind);
    if (!read.synced) continue;
    anySynced = true;
    const item = parseAll(read, parse).find((r) => r.id === id);
    if (item) return { state: "local", projectId: candidate, syncedAt: read.syncedAt, item };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

/** Lower number first, a row without a number last, then by id (never "whatever order IndexedDB returned"). */
const byNumber = <T extends { number: number | null; id: string }>(a: T, b: T): number =>
  a.number === b.number ? a.id.localeCompare(b.id) : a.number === null ? 1 : b.number === null ? -1 : a.number - b.number;

export const loadRfis = (data: ShellData, projectId: string | null) => list(data, projectId, SITE_KINDS.rfis, toLocalRfi, byNumber);
export const loadRfi = (data: ShellData, id: string, projectId: string | null) => find(data, id, projectId, SITE_KINDS.rfis, toLocalRfi);
export const loadSubmittals = (data: ShellData, projectId: string | null) => list(data, projectId, SITE_KINDS.submittals, toLocalSubmittal, byNumber);
export const loadSubmittal = (data: ShellData, id: string, projectId: string | null) => find(data, id, projectId, SITE_KINDS.submittals, toLocalSubmittal);
export const loadPunchList = (data: ShellData, projectId: string | null) => list(data, projectId, SITE_KINDS.punch, toLocalPunchItem, byNumber);
export const loadPunchItem = (data: ShellData, id: string, projectId: string | null) => find(data, id, projectId, SITE_KINDS.punch, toLocalPunchItem);
/** Latest day first (a site person looks for today and yesterday). */
export const loadDiaries = (data: ShellData, projectId: string | null) =>
  list(data, projectId, SITE_KINDS.diaries, toLocalDiary, (a, b) => (a.diaryDate === b.diaryDate ? a.id.localeCompare(b.id) : a.diaryDate < b.diaryDate ? 1 : -1));
export const loadDiary = (data: ShellData, id: string, projectId: string | null) => find(data, id, projectId, SITE_KINDS.diaries, toLocalDiary);
export const loadFfeItems = (data: ShellData, projectId: string | null) =>
  list(data, projectId, SITE_KINDS.ffe, toLocalFfeItem, (a, b) => a.itemName.localeCompare(b.itemName) || a.id.localeCompare(b.id));
export const loadFfeItem = (data: ShellData, id: string, projectId: string | null) => find(data, id, projectId, SITE_KINDS.ffe, toLocalFfeItem);
