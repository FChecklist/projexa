// LOCAL-FIRST shell, Labour, read from the laptop's own database.
//
// THE ONLINE SCREENS (src/app/(app)/labour): /labour with ?tab=roster (ID, Name, Trade, Company, Daily Rate, Status), ?tab=attendance
// (Date, Worker, Status, Hours, Cost, plus a server-computed trade summary), ?tab=summary (the server's daily manpower summary);
// /labour/:id (one worker and their attendance); /labour/attendance/new (mark one worker); /labour/attendance/:date (the day's sheet);
// /labour/new and /labour/import (create workers).
//
// WHAT THE LAPTOP HAS. Kinds `roster` (id, name, trade, skill_level, employee_code, is_active, daily_rate) and `attendance` (id,
// roster_id, attendance_date, status, hours_worked, daily_cost). `daily_rate` and `daily_cost` are MONEY: below the role that may see
// them the sync sends them NULL and names them in hidden_fields; this adapter ALSO drops them whenever they are named hidden (a row
// that somehow carries a value is not trusted over the marker). Counts of present / half day / absent are counts, not money, and are
// made here; a COST total is never summed on the laptop (the server's own summary does that, with its rules for half days).
//
// GAPS: "Company" is a vendor id; vendors are an organisation kind the client engine does not consume yet (the screen says "-").

import type { ShellData } from "../context";
import { DELIVERY_KINDS, parseAttendance, parseWorker, readKind, type AttendanceMark, type Worker } from "./delivery-local";

export const isTempId = (id: string): boolean => id.startsWith("local-");

export type AttendanceRow = AttendanceMark & { workerName: string | null; trade: string | null; waiting: boolean };
export type DayCounts = { present: number; halfDay: number; absent: number; marked: number };

export type LabourData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | {
      state: "local";
      projectId: string;
      workers: Worker[];
      /** Newest first. Null when attendance is not on the laptop (the roster still shows). */
      attendance: AttendanceRow[] | null;
      today: DayCounts | null;
      rateHidden: boolean;
      costHidden: boolean;
      syncedAt: number;
    };

export type WorkerData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; worker: Worker; attendance: AttendanceRow[] | null; rateHidden: boolean; costHidden: boolean; syncedAt: number };

export type AttendanceSheetData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "invalid_date" }
  | {
      state: "local";
      projectId: string;
      date: string;
      /** Every active worker, with that day's mark when there is one. */
      rows: { worker: Worker; mark: AttendanceRow | null }[];
      counts: DayCounts;
      costHidden: boolean;
      syncedAt: number;
    };

async function readLabour(data: ShellData, projectId: string) {
  const [roster, attendance] = await Promise.all([
    readKind(data, projectId, DELIVERY_KINDS.roster, parseWorker),
    readKind(data, projectId, DELIVERY_KINDS.attendance, parseAttendance),
  ]);
  if (!roster.synced) return null;
  const rateHidden = roster.hidden.includes("daily_rate");
  const workers = roster.rows.map((w) => (rateHidden ? { ...w, dailyRate: null } : w)).sort((a, b) => a.name.localeCompare(b.name));
  const costHidden = attendance.synced ? attendance.hidden.includes("daily_cost") : true;
  let marks: AttendanceRow[] | null = null;
  if (attendance.synced) {
    const byId = new Map(workers.map((w) => [w.id, w]));
    marks = attendance.rows
      .map((m) => {
        const w = byId.get(m.rosterId);
        return { ...m, dailyCost: costHidden ? null : m.dailyCost, workerName: w?.name ?? null, trade: w?.trade ?? null, waiting: isTempId(m.id) };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || (a.workerName ?? "").localeCompare(b.workerName ?? ""));
  }
  return { workers, marks, rateHidden, costHidden, syncedAt: roster.syncedAt };
}

/** Counts one day's marks. When a worker has two marks that day (one waiting to be sent), the waiting one is what the person said last. */
export function countDay(marks: readonly AttendanceRow[], date: string): DayCounts {
  const latest = latestMarks(marks, date);
  const counts: DayCounts = { present: 0, halfDay: 0, absent: 0, marked: 0 };
  for (const m of latest.values()) {
    counts.marked += 1;
    if (m.status === "present") counts.present += 1;
    else if (m.status === "half_day") counts.halfDay += 1;
    else if (m.status === "absent") counts.absent += 1;
  }
  return counts;
}

function latestMarks(marks: readonly AttendanceRow[], date: string): Map<string, AttendanceRow> {
  const latest = new Map<string, AttendanceRow>();
  for (const m of marks) {
    if (m.date !== date) continue;
    const prev = latest.get(m.rosterId);
    if (!prev || (m.waiting && !prev.waiting)) latest.set(m.rosterId, m);
  }
  return latest;
}

export async function loadLabour(data: ShellData, projectId: string | null, today: string): Promise<LabourData> {
  if (!projectId) return { state: "no_project" };
  const read = await readLabour(data, projectId);
  if (!read) return { state: "not_synced", projectId };
  return {
    state: "local", projectId, workers: read.workers, attendance: read.marks, today: read.marks ? countDay(read.marks, today) : null,
    rateHidden: read.rateHidden, costHidden: read.costHidden, syncedAt: read.syncedAt,
  };
}

export async function loadWorker(data: ShellData, workerId: string, projectId: string | null): Promise<WorkerData> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const read = await readLabour(data, candidate);
    if (!read) continue;
    anySynced = true;
    const worker = read.workers.find((w) => w.id === workerId);
    if (!worker) continue;
    return {
      state: "local", projectId: candidate, worker, attendance: read.marks ? read.marks.filter((m) => m.rosterId === workerId) : null,
      rateHidden: read.rateHidden, costHidden: read.costHidden, syncedAt: read.syncedAt,
    };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

export async function loadAttendanceSheet(data: ShellData, projectId: string | null, date: string): Promise<AttendanceSheetData> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { state: "invalid_date" };
  if (!projectId) return { state: "no_project" };
  const read = await readLabour(data, projectId);
  if (!read || !read.marks) return { state: "not_synced", projectId };
  const latest = latestMarks(read.marks, date);
  const rows = read.workers.filter((w) => w.isActive || latest.has(w.id)).map((worker) => ({ worker, mark: latest.get(worker.id) ?? null }));
  return { state: "local", projectId, date, rows, counts: countDay(read.marks, date), costHidden: read.costHidden, syncedAt: read.syncedAt };
}
