// LOCAL-FIRST browser AI: the write functions an AI may propose on this laptop, and the role rule that decides them
// LOCALLY (requirements R6, R7, R11).
//
// THE SOURCE. function-registry.json is a copy of the AI work link's own registry (compliance-tracker
// supabase/functions/ai-work-link/function-registry.generated.json), refreshed by scripts/vendor-ai-function-registry.mjs.
// The same function ids and the same `min_role_rank` the server's push gate (drizzle/0681 projexa_sync_push_begin)
// checks. A function is usable here exactly when the server would accept it on push: a WRITE, on a link level
// (link_level not null), not excluded.
//
// THE ROLE RANKS are the ones of compliance-tracker src/lib/supabase/role-rank.ts (and SQL ai_work_link__role_rank):
// viewer 1, member 2, manager 3, branch_manager 4, admin 5, veridian_admin 6. An unknown or missing role is rank 0:
// it may read what is on the laptop and write nothing.
//
// LOCAL CHECK, SERVER AUTHORITY. This file only lets the laptop say "no" early, in plain words, while it is offline.
// It can never grant anything: every op is checked again by the server, as the person with their LIVE role.
//
// PURE: no browser global, no clock, no import of anything with a side effect.

import registryFile from "./function-registry.json";

export type RegistryFunction = {
  function_id: string;
  label: string;
  module: string;
  kind: string;
  link_level: number | null;
  min_role_rank: number;
  money_sensitive: boolean;
  excluded_reason: string | null;
  declared_params: string[];
  required_params: { name: string; label: string; any_of: string[] }[];
  id_params: string[];
};

/** create: makes a new record. update: changes one the laptop holds. delete: removes / voids one (needs a confirmation). */
export type WriteAction = "create" | "update" | "delete";

export const ROLE_RANK: Readonly<Record<string, number>> = Object.freeze({
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2,
  senior_professional: 3, manager: 3,
  branch_manager: 4,
  admin: 5,
  veridian_admin: 6,
});

/** The lowest role name of each rank, for plain-words messages ("needs a member or higher"). */
const RANK_WORD: Readonly<Record<number, string>> = Object.freeze({ 1: "viewer", 2: "member", 3: "manager", 4: "branch manager", 5: "admin", 6: "platform admin" });

export function rankOf(role: string | null | undefined): number {
  return (role && ROLE_RANK[role]) || 0;
}

export function rankWord(rank: number): string {
  return RANK_WORD[rank] ?? (rank <= 0 ? "anyone" : `rank ${rank}`);
}

export const REGISTRY_SOURCE_COMMIT: string = (registryFile as { source_commit: string }).source_commit;

const ALL: readonly RegistryFunction[] = Object.freeze((registryFile as { functions: RegistryFunction[] }).functions.map((f) => Object.freeze({ ...f })));

/** Every write the server would accept on push from SOME role (link level set, not excluded). */
export const WRITE_FUNCTIONS: readonly RegistryFunction[] = Object.freeze(ALL.filter((f) => f.kind === "write" && f.link_level !== null && !f.excluded_reason));

const BY_ID = new Map(WRITE_FUNCTIONS.map((f) => [f.function_id, f]));

export function findFunction(functionId: string): RegistryFunction | undefined {
  return BY_ID.get(functionId);
}

// The registry has no "action" column, so it is read from the verb the id starts with. A delete is a function that
// REMOVES or VOIDS a record; everything that starts a new record is a create; the rest change an existing record.
// The removals are the registry's own (delete_permit, delete_mom, archive_task... since compliance-tracker drizzle/0685 + 0687; the
// copy was refreshed by lf-e10b): never invented here.
const DELETE_VERBS = ["delete_", "remove_", "void_", "archive_", "cancel_"];
const CREATE_VERBS = ["create_", "add_", "record_", "capture_", "apply_", "place_", "log_", "link_"];

export function actionOf(functionId: string): WriteAction {
  if (DELETE_VERBS.some((v) => functionId.startsWith(v))) return "delete";
  if (CREATE_VERBS.some((v) => functionId.startsWith(v))) return "create";
  return "update";
}

/** The writes a person of this rank may propose, grouped by action. */
export function functionsForRank(rank: number): Record<WriteAction, RegistryFunction[]> {
  const out: Record<WriteAction, RegistryFunction[]> = { create: [], update: [], delete: [] };
  for (const f of WRITE_FUNCTIONS) if (rank >= f.min_role_rank) out[actionOf(f.function_id)].push(f);
  return out;
}

export type WriteRefusal = { ok: false; code: "UNKNOWN_FUNCTION" | "WRONG_ACTION" | "ROLE_TOO_LOW" | "MISSING_PARAMS" | "UNKNOWN_PARAMS" | "BAD_PARAMS"; message: string; missing?: string[] };
export type WriteDecision = { ok: true; fn: RegistryFunction } | WriteRefusal;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

/**
 * Decides, on this laptop, whether a person of `rank` may propose `functionId` as `action` with `params`.
 * Plain words in every refusal: they are shown to the person and read by their AI.
 */
export function checkWrite(input: { functionId: string; action: WriteAction; rank: number; role?: string | null; params: unknown }): WriteDecision {
  const fn = findFunction(input.functionId);
  if (!fn) {
    return { ok: false, code: "UNKNOWN_FUNCTION", message: `PROJEXA has no write called "${input.functionId}". Ask manifest() for the list of things you can do.` };
  }
  const actual = actionOf(fn.function_id);
  if (actual !== input.action) {
    return { ok: false, code: "WRONG_ACTION", message: `"${fn.label}" is a ${actual}, not a ${input.action}. Use ${actual}() for it.` };
  }
  if (input.rank < fn.min_role_rank) {
    const who = input.role ? `Your role (${input.role})` : "This laptop does not know your role yet, so it";
    return { ok: false, code: "ROLE_TOO_LOW", message: `${who} cannot do "${fn.label}". It needs a ${rankWord(fn.min_role_rank)} or higher.` };
  }
  if (!isPlainObject(input.params)) {
    return { ok: false, code: "BAD_PARAMS", message: `"${fn.label}" needs its details as an object of named values.` };
  }
  const params = input.params;
  const declared = new Set(fn.declared_params);
  const unknown = Object.keys(params).filter((k) => !declared.has(k));
  if (unknown.length) {
    return { ok: false, code: "UNKNOWN_PARAMS", message: `"${fn.label}" does not take ${unknown.map((k) => `"${k}"`).join(", ")}. It takes: ${fn.declared_params.join(", ")}.` };
  }
  const missing = fn.required_params.filter((r) => !r.any_of.some((name) => present(params[name])));
  if (missing.length) {
    return { ok: false, code: "MISSING_PARAMS", message: `"${fn.label}" still needs: ${missing.map((m) => m.label).join(", ")}.`, missing: missing.map((m) => m.name) };
  }
  return { ok: true, fn };
}

/** The record kind a create function adds, when the laptop syncs that kind (so the new row can show at once). */
export const CREATES_KIND: Readonly<Record<string, string>> = Object.freeze({
  create_rfi: "rfis",
  create_schedule_task: "tasks",
  create_meeting: "meetings",
  create_document: "documents",
  create_drawing: "drawings",
  create_permit: "permits",
  create_submittal: "submittals",
  create_punch_list_item: "punch_list",
  create_change_order: "change_orders",
  create_site_diary: "site_diaries",
  create_site_instruction: "site_instructions",
  create_milestone: "milestones",
  create_material: "materials",
  record_material_receipt: "material_receipts",
  record_material_issue: "material_issues",
  create_wiki_page: "wiki_pages",
  create_ffe_item: "ffe_items",
  create_boq: "boqs",
  create_activity: "activities",
  record_work_progress: "progress",
  add_roster_entry: "roster",
  record_attendance: "attendance",
  record_timesheet: "timesheets",
  create_progress_claim: "progress_claims",
});
