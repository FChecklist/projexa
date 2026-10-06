import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../__fixtures__/fake-sync-server";
import { LOCAL_FIRST_FLAG } from "../local-reader";
import { answerRfiLocally, createRfiLocally, updateTaskLocally } from "../local-writes";
import type { EnqueueInput, Outbox } from "../outbox";
import { createReplica } from "../replica";
import type { ShellData } from "../shell/context";
import { addWorkerOffline, createMaterialOffline, createTaskOffline, markAttendanceOffline, recordIssueOffline, recordProgressOffline, recordReceiptOffline } from "../shell/modules/delivery-writes";
import {
  approveTimeEntryOffline, createChangeOrderOffline, recordTimeEntryOffline, rejectTimeEntryOffline, submitChangeOrderOffline, submitTimeEntryOffline,
} from "../shell/modules/design-change-writes";
import { amendMinutesOffline, createMomOffline, editDocumentDetailsOffline } from "../shell/modules/documents-writes";
import {
  advanceFfeOffline, answerRfiOffline, closeRfiOffline, createPunchItemOffline, createRfiOffline, createSiteDiaryOffline, createSubmittalOffline,
  markPunchReadyOffline, reviewSubmittalOffline, verifyPunchClosedOffline,
} from "../shell/modules/site-writes";
import { LIVE_FUNCTION_IDS, LIVE_SOURCE_COMMIT, LIVE_WRITES, type LiveWrite } from "./__fixtures__/live-registry-contract";
import registryFile from "./function-registry.json";
import { actionOf, type RegistryFunction } from "./registry";

// LOCAL-FIRST CONTRACT (package lf-e11): every write this laptop can put in its outbox is sent to the REAL pipeline as
// {function_id, params} (the AI work link runs compliance-tracker src/lib/pipeline/function-registry.ts). A param name
// the live registry does not take, or a required one the laptop never sends, is a write the live server REJECTS -- found
// only after it sat in the outbox for hours. So this file checks, with no browser and no network:
//
//   1. the laptop's registry copy (function-registry.json, what the browser AI is told and checked against) is EXACTLY
//      the live registry's write part: the same ids, the same parameter names, the same role ranks and money flags;
//   2. every write the laptop builds itself (local-writes.ts, shell/modules/*-writes.ts) is RUN here against a seeded
//      laptop copy with a capturing outbox, and the params it really builds are checked against the live registry's
//      declared and required names (the fixture __fixtures__/live-registry-contract.ts, generated from a
//      compliance-tracker checkout by scripts/vendor-ai-registry-contract.mjs, each id with its spec's source line);
//   3. no source file can enqueue a function id that this file does not check (a new writer fails here until added);
//   4. the browser AI treats every live function that removes, voids, disposes of, archives or cancels a record as a
//      DELETE (a draft the person confirms), never as an update the AI may send by itself.
//
// Refresh after the backend registry changes:
//   node scripts/vendor-ai-function-registry.mjs <compliance-tracker>   (the laptop's copy)
//   node scripts/vendor-ai-registry-contract.mjs <compliance-tracker>   (this test's fixture)

const VENDORED = (registryFile as { source_commit: string; functions: RegistryFunction[] }).functions;

/** Why a built param set would be refused by the live pipeline, in words a reader can act on; empty = accepted. */
export function contractProblems(functionId: string, params: Record<string, unknown>, live: Readonly<Record<string, LiveWrite>> = LIVE_WRITES): string[] {
  const spec = live[functionId];
  if (!spec) return [`"${functionId}" is not a write of the live registry (compliance-tracker@${LIVE_SOURCE_COMMIT.slice(0, 8)})`];
  const problems: string[] = [];
  if (spec.excluded) problems.push(`"${functionId}" is excluded from the AI work link on the live registry`);
  if (spec.link_level === null) problems.push(`"${functionId}" has no link level on the live registry (the push gate refuses it)`);
  const declared = new Set(spec.declared);
  for (const key of Object.keys(params)) if (!declared.has(key)) problems.push(`"${functionId}" is sent "${key}", which the live registry does not take (it takes: ${spec.declared.join(", ")})`);
  for (const req of spec.required) {
    const given = req.any_of.some((name) => params[name] !== undefined && params[name] !== null && params[name] !== "");
    if (!given) problems.push(`"${functionId}" is sent without "${req.name}" (any of ${req.any_of.join(" / ")}), which the live registry requires`);
  }
  return problems;
}

// ─── 1. the laptop's copy IS the live registry's write part ─────────────────────────────────────────────────────

describe("function-registry.json (the browser AI's copy) equals the live registry's writes", () => {
  test("the fixture is the live registry: every id, reads included", () => {
    // 159 on compliance-tracker main of 2026-10-02 (d1119f69); a refresh of the fixture moves this with the registry.
    expect(LIVE_FUNCTION_IDS.length).toBeGreaterThanOrEqual(159);
    expect(new Set(LIVE_FUNCTION_IDS).size).toBe(LIVE_FUNCTION_IDS.length);
    for (const id of Object.keys(LIVE_WRITES)) expect(LIVE_FUNCTION_IDS).toContain(id);
  });

  test("the same write function ids, none missing, none extra", () => {
    const vendored = VENDORED.map((f) => f.function_id).sort();
    const live = Object.keys(LIVE_WRITES).sort();
    const missing = live.filter((id) => !vendored.includes(id));
    const extra = vendored.filter((id) => !live.includes(id));
    expect({ missing, extra }, `function-registry.json is stale: re-run scripts/vendor-ai-function-registry.mjs against compliance-tracker@${LIVE_SOURCE_COMMIT.slice(0, 8)}`).toEqual({ missing: [], extra: [] });
  });

  test("each write: the same parameter names, required names, role rank, money flag and link level", () => {
    const drift: string[] = [];
    for (const f of VENDORED) {
      const live = LIVE_WRITES[f.function_id];
      if (!live) continue; // reported by the test above
      const mine = {
        declared: [...f.declared_params].sort(), required: f.required_params.map((r) => ({ name: r.name, any_of: r.any_of })),
        min_role_rank: f.min_role_rank, money_sensitive: f.money_sensitive, link_level: f.link_level, excluded: f.excluded_reason !== null,
      };
      if (JSON.stringify(mine) !== JSON.stringify(live)) drift.push(`${f.function_id}: laptop ${JSON.stringify(mine)} != live ${JSON.stringify(live)}`);
    }
    expect(drift).toEqual([]);
  });
});

// ─── 2. the params the laptop REALLY builds ─────────────────────────────────────────────────────────────────────

type Captured = { functionId: string; params: Record<string, unknown> };

const P = "p1";
const KINDS = ["tasks", "rfis", "roster", "attendance", "materials", "material_receipts", "material_issues", "activities", "boq_lines", "progress", "change_orders", "timesheets", "documents", "meeting_minutes", "submittals", "punch_list", "site_diaries", "ffe_items"].map((kind) => ({ kind }));

const captured: Captured[] = [];
let idb: IDBFactory;
let data: ShellData;
const outbox = {
  enqueue: async (input: EnqueueInput) => {
    captured.push({ functionId: input.functionId, params: structuredClone(input.params) });
    return { opId: `op-${captured.length}` };
  },
} as unknown as Outbox;

let savedStorage: unknown;

beforeAll(async () => {
  savedStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const map = new Map<string, string>([[LOCAL_FIRST_FLAG, "1"]]);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  idb = new IDBFactory();
  const server = createFakeSyncServer({ kinds: KINDS });
  server.upsert({ kind: "tasks", projectId: P, id: "t1", data: { title: "Pour slab", statusId: "s1", priority: "medium", completionPercentage: 10 } });
  server.upsert({ kind: "rfis", projectId: P, id: "r1", data: { subject: "Door", question: "Which?", status: "open", answer: null } });
  server.upsert({ kind: "roster", projectId: P, id: "w1", data: { id: "w1", name: "Ravi", trade: "mason", is_active: true, daily_rate: null } });
  server.upsert({ kind: "materials", projectId: P, id: "m1", data: { id: "m1", name: "Cement", unit: "bag", is_active: true, unit_cost: null } });
  server.upsert({ kind: "boq_lines", projectId: P, id: "l1", data: { id: "l1", boq_id: "b1", item_code: "01", description: "Blockwork", unit: "m2", quantity: "100" } });
  server.upsert({ kind: "activities", projectId: P, id: "a1", data: { id: "a1", name: "Activity 1" } });
  server.upsert({ kind: "change_orders", projectId: P, id: "co1", data: { id: "co1", title: "Extra door", status: "draft" } });
  server.upsert({ kind: "timesheets", projectId: P, id: "ts1", data: { id: "ts1", issue_id: "t1", hours: 2, spent_on: "2026-09-01" } });
  server.upsert({ kind: "documents", projectId: P, id: "d1", data: { id: "d1", name: "Contract", category: "contract", expiry_date: null } });
  server.upsert({ kind: "meeting_minutes", projectId: P, id: "mm1", data: { id: "mm1", title: "Weekly", status: "draft", published_at: null, minutes: "Old" } });
  server.upsert({ kind: "rfis", projectId: P, id: "r2", data: { id: "r2", number: 2, subject: "Slab", question: "Depth?", status: "open", answer: null } });
  server.upsert({ kind: "rfis", projectId: P, id: "r3", data: { id: "r3", number: 3, subject: "Sill", question: "Height?", status: "answered", answer: "1m" } });
  server.upsert({ kind: "submittals", projectId: P, id: "s1", data: { id: "s1", number: 1, title: "Tiles", status: "pending" } });
  server.upsert({ kind: "punch_list", projectId: P, id: "x1", data: { id: "x1", number: 1, description: "Door gap", status: "open" } });
  server.upsert({ kind: "punch_list", projectId: P, id: "x2", data: { id: "x2", number: 2, description: "Paint", status: "ready_for_review" } });
  server.upsert({ kind: "ffe_items", projectId: P, id: "f1", data: { id: "f1", item_name: "Chair", status: "specified", unit_cost: 100, unit_price: 150 } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  data = { userId: "u1", name: "Asha", email: null, role: "manager", orgId: "orgA", idb: idb as unknown as globalThis.IDBFactory, projects: [{ id: P, name: "Cedar" }] };

  // Every writer, with EVERY optional field filled, so the widest param set each one can build is checked.
  const access = { userId: "u1", idb: idb as unknown as globalThis.IDBFactory, outbox };
  const results = [
    await createRfiLocally({ projectId: P, subject: "Hinge", question: "Which hinge?", dueDate: "2026-10-09" }, access),
    await answerRfiLocally({ projectId: P, rfiId: "r1", answer: "Brass" }, access),
    await updateTaskLocally({ projectId: P, taskId: "t1", patch: { title: "T", description: "D", priority: "high", statusId: "s2", startDate: "2026-10-01", dueDate: "2026-10-05", completionPercentage: 50 } }, access),
    await markAttendanceOffline(data, { projectId: P, rosterId: "w1", date: "2026-10-01", status: "present", hours: 8 }, { outbox }),
    await recordIssueOffline(data, { projectId: P, materialId: "m1", quantity: 3, issuedDate: "2026-10-01", boqLineItemId: "l1", issuedTo: "Ravi", note: "for slab" }, { outbox }),
    await recordReceiptOffline(data, { projectId: P, materialId: "m1", quantity: 10, receivedDate: "2026-10-01", reference: "GRN-1", notes: "ok" }, { outbox }),
    await recordProgressOffline(data, { projectId: P, boqLineItemId: "l1", entryDate: "2026-10-01", quantityDone: 4, remarks: "half" }, { outbox }),
    await recordProgressOffline(data, { projectId: P, boqLineItemId: "l1", entryDate: "2026-10-01", percent: 40 }, { outbox }),
    // the three creates that no longer need a connection (G-15), every optional field filled
    await addWorkerOffline(data, { projectId: P, name: "A. Worker", trade: "Mason", dailyRate: 800, employeeCode: "E-9" }, { outbox }),
    await createMaterialOffline(data, { projectId: P, name: "Sand, fine", unit: "cum", spec: "Zone II", unitCost: 1800, reorderLevel: 5 }, { outbox }),
    await createTaskOffline(data, { projectId: P, title: "Pour slab", startDate: "2026-10-05", dueDate: "2026-10-09", durationDays: 3, description: "Level 2", priority: "high" }, { outbox }),
    await createChangeOrderOffline({ projectId: P, title: "Extra door", reason: "client", costImpact: "1200", scheduleImpactDays: "3" }, access),
    await submitChangeOrderOffline({ projectId: P, changeOrderId: "co1", signers: [{ name: "Asha Rao", email: "asha@example.invalid" }] }, access),
    await recordTimeEntryOffline({ projectId: P, issueId: "t1", hours: "2", spentOn: "2026-10-01", activityType: "design" }, access),
    await submitTimeEntryOffline({ projectId: P, timeEntryId: "ts1" }, access),
    await approveTimeEntryOffline({ projectId: P, timeEntryId: "ts1" }, access),
    await rejectTimeEntryOffline({ projectId: P, timeEntryId: "ts1", rejectionReason: "wrong day" }, access),
    await amendMinutesOffline(data, { projectId: P, meetingId: "mm1", minutes: "New minutes" }, { outbox }),
    await createMomOffline(data, { projectId: P, title: "Site meeting", scheduledAt: "2026-10-12T10:30", meetingType: "site", attendees: ["Asha", "Ravi"], agenda: ["Slab", "Safety"], minutes: "Pour agreed." }, { outbox }),
    await editDocumentDetailsOffline(data, "documents", { projectId: P, documentId: "d1", details: { name: "Contract v2", category: "legal", expiryDate: "2027-01-01" } }, { outbox }),
    // the site cluster (shell/modules/site-writes.ts), every optional field filled
    await createRfiOffline(data, { projectId: P, subject: "Sill", question: "Height?", dueDate: "2026-10-09" }, { outbox }),
    await createSubmittalOffline(data, { projectId: P, title: "Tiles", specSection: "09 30 00", type: "sample", dueDate: "2026-10-09" }, { outbox }),
    await createPunchItemOffline(data, { projectId: P, description: "Door gap", location: "L2", trade: "joinery", priority: "high" }, { outbox }),
    await createSiteDiaryOffline(data, { projectId: P, diaryDate: "2026-10-01", weather: "Clear", workDone: "Slab", visitors: "Client", labourCount: 12, issues: "None", instructions: "Pour Monday", materialReceived: "Cement", remarks: "ok" }, { outbox }),
    await answerRfiOffline(data, { projectId: P, rfiId: "r2", answer: "200mm" }, { outbox }),
    await closeRfiOffline(data, { projectId: P, rfiId: "r3" }, { outbox }),
    await markPunchReadyOffline(data, { projectId: P, itemId: "x1" }, { outbox }),
    await verifyPunchClosedOffline(data, { projectId: P, itemId: "x2" }, { outbox }),
    await reviewSubmittalOffline(data, { projectId: P, submittalId: "s1", status: "approved_as_noted", comments: "see mark-up" }, { outbox }),
    await advanceFfeOffline(data, { projectId: P, itemId: "f1", status: "ordered" }, { outbox }),
  ];
  // A writer that refused would hide its params from this check: every one must have queued.
  const refused = results.map((r, i) => ({ i, r })).filter(({ r }) => !r || ("queued" in r ? r.queued !== true : (r as { ok?: boolean }).ok !== true));
  if (refused.length) throw new Error(`a writer did not queue in the contract rig: ${JSON.stringify(refused)}`);
});

afterAll(() => {
  (globalThis as { localStorage?: unknown }).localStorage = savedStorage;
});

/** The create a deleted task's edit is kept as (outbox.ts RECREATE), with every field it can carry. Not exported, so its literal shape is read from the source below. */
const RECREATE_TASK: Captured = { functionId: "create_schedule_task", params: { projectId: P, title: "T", startDate: "2026-10-01", description: "D", priority: "high", dueDate: "2026-10-05" } };

describe("every write the laptop builds uses the live registry's parameter names", () => {
  test("the rig queued every writer (30 ops, 27 function ids)", () => {
    expect(captured).toHaveLength(30);
    expect(new Set(captured.map((c) => c.functionId)).size).toBe(27);
  });

  test("each built op: a live write, every param a declared name, every required name present", () => {
    const problems = [...captured, RECREATE_TASK].flatMap((c) => contractProblems(c.functionId, c.params));
    expect(problems).toEqual([]);
  });

  test("update_task is sent with issueId (the registry's name), never taskId", () => {
    const op = captured.find((c) => c.functionId === "update_task")!;
    expect(op.params.issueId).toBe("t1");
    expect("taskId" in op.params).toBe(false);
  });

  test("outbox.ts's recreate of a deleted task still builds exactly the keys checked above", () => {
    const src = readFileSync(join(import.meta.dir, "..", "outbox.ts"), "utf8");
    expect(src).toContain(`functionId: "create_schedule_task"`);
    expect(src).toContain("const params: Record<string, unknown> = { projectId, title, startDate };");
    expect(src).toContain(`for (const k of ["description", "priority", "dueDate"])`);
  });

  test("the checker itself refuses a wrong name and a missing required one (it is not a rubber stamp)", () => {
    expect(contractProblems("update_task", { projectId: P, taskId: "t1", title: "x" })).toEqual([
      expect.stringContaining(`sent "taskId"`),
      expect.stringContaining(`without "issueId"`),
    ]);
    expect(contractProblems("no_such_function", {})).toEqual([expect.stringContaining("not a write of the live registry")]);
  });
});

// ─── 3. no writer escapes this file ─────────────────────────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__fixtures__" || e.name === "conformance" ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test("every function id a laptop source file enqueues is one this test checks, and a live write", () => {
  const root = join(import.meta.dir, "..");
  const checked = new Set([...captured.map((c) => c.functionId), RECREATE_TASK.functionId]);
  const found = new Map<string, string>();
  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/functionId:\s*"([a-z0-9_]+)"/g)) found.set(m[1], file.slice(root.length + 1));
    // decideEntry's functions are passed as `decideEntry("<id>", ...)`
    for (const m of src.matchAll(/decideEntry\("([a-z0-9_]+)"/g)) found.set(m[1], file.slice(root.length + 1));
  }
  const unchecked = [...found].filter(([id]) => !checked.has(id)).map(([id, file]) => `${id} (${file})`);
  const notLive = [...found.keys()].filter((id) => !LIVE_WRITES[id]);
  expect({ unchecked, notLive }).toEqual({ unchecked: [], notLive: [] });
});

// ─── 4. the AI's deletes are deletes ────────────────────────────────────────────────────────────────────────────

describe("every live write that removes a record is a DELETE for the browser AI (a draft the person confirms)", () => {
  const REMOVES = /\b(delete|remove|void|dispose|archive|cancel|discard)\b/i;
  test("by its live label", () => {
    const wrong = VENDORED.filter((f) => REMOVES.test(f.label) && actionOf(f.function_id) !== "delete").map((f) => `${f.function_id} ("${f.label}") is a ${actionOf(f.function_id)}`);
    expect(wrong).toEqual([]);
  });
  test("dispose_document in particular (marks a document disposed: not something an AI may do without asking)", () => {
    expect(actionOf("dispose_document")).toBe("delete");
  });
});
