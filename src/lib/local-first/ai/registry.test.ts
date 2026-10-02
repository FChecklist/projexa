// The local role rule (registry.ts): the same ids and min_role_rank as the server's push gate, the role ranks of
// compliance-tracker role-rank.ts, and the plain-words refusals.

import { describe, expect, test } from "bun:test";
import registryFile from "./function-registry.json";
import { ROLE_RANK, WRITE_FUNCTIONS, actionOf, checkWrite, findFunction, functionsForRank, rankOf } from "./registry";

describe("registry", () => {
  test("usable = write, on a link level, not excluded (what the server's push gate accepts)", () => {
    const all = (registryFile as { functions: { function_id: string; kind: string; link_level: number | null; excluded_reason: string | null }[] }).functions;
    // lf-e10b re-vendored from compliance-tracker main (d1119f69): 118 write functions (was 73, before the AI CRUD functions of
    // drizzle/0685 + 0687 existed in the copy).
    expect(all.length).toBe(118);
    expect(WRITE_FUNCTIONS.map((f) => f.function_id)).toEqual(all.filter((f) => f.kind === "write" && f.link_level !== null && !f.excluded_reason).map((f) => f.function_id));
    expect(findFunction("link_roster_employee")).toBeUndefined();
    expect(registryFile.source_commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test("ranks match compliance-tracker role-rank.ts", () => {
    expect(ROLE_RANK).toEqual({ viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1, member: 2, team_member: 2, senior_professional: 3, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 });
    expect(rankOf(null)).toBe(0);
    expect(rankOf("nobody")).toBe(0);
  });

  test("actions read from the verb", () => {
    expect(actionOf("create_rfi")).toBe("create");
    expect(actionOf("add_room")).toBe("create");
    expect(actionOf("record_work_progress")).toBe("create");
    expect(actionOf("update_task")).toBe("update");
    expect(actionOf("approve_timesheet")).toBe("update");
    expect(actionOf("reject_timesheet")).toBe("update");
    expect(actionOf("draft_progress_claim")).toBe("update");
    expect(actionOf("void_material_receipt")).toBe("delete");
    // The removals the registry really has (the AI CRUD functions of compliance-tracker drizzle/0685 + 0687); each is a DRAFT the
    // person confirms (R7). Read from the registry, never invented.
    expect(WRITE_FUNCTIONS.filter((f) => actionOf(f.function_id) === "delete").map((f) => f.function_id)).toEqual([
      "archive_project", "archive_task", "cancel_change_order", "delete_attendance", "delete_boq", "delete_boq_category", "delete_meeting", "delete_mom",
      "delete_permit", "delete_progress_entry", "delete_time_entry", "remove_mood_board_item", "remove_placement", "remove_room", "remove_sprint_task",
      "void_material_receipt",
    ]);
  });

  test("functionsForRank is monotonic and complete at the top", () => {
    const count = (r: number) => Object.values(functionsForRank(r)).flat().length;
    expect(count(0)).toBe(0);
    expect(count(1)).toBe(0);
    expect(count(2)).toBeGreaterThan(0);
    expect(count(3)).toBeGreaterThan(count(2));
    expect(count(6)).toBe(WRITE_FUNCTIONS.length);
  });

  test("checkWrite refuses in plain words", () => {
    const params = { projectId: "p1", subject: "s", question: "q" };
    expect(checkWrite({ functionId: "create_rfi", action: "create", rank: 2, role: "member", params })).toMatchObject({ ok: true });
    const low = checkWrite({ functionId: "create_rfi", action: "create", rank: 1, role: "viewer", params });
    expect(low).toEqual({ ok: false, code: "ROLE_TOO_LOW", message: 'Your role (viewer) cannot do "New RFI". It needs a member or higher.' });
    expect(checkWrite({ functionId: "create_rfi", action: "create", rank: 2, params: { ...params, question: "  " } })).toMatchObject({ ok: false, code: "MISSING_PARAMS", missing: ["question"] });
    expect(checkWrite({ functionId: "create_rfi", action: "create", rank: 2, params: "x" })).toMatchObject({ ok: false, code: "BAD_PARAMS" });
  });
});
