import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
  MEETINGS_KIND, PROJECT_KIND, WIKI_KIND, loadMeetingObject, loadMeetingsList, loadProjectsList, loadSettings, loadWikiList, loadWikiObject, loadWorkspace,
  toLocalMeeting, toLocalProject, toLocalWikiPage,
} from "./platform-adapter";
import { workspaceLinks } from "./workspace-links";
import { shellData } from "./documents-test-fixtures";
import { meetingRow, projectRow, seedPlatform, wikiRow } from "./platform-test-fixtures";

// The adapters read the person's own IndexedDB and nothing else: any fetch is a failure.
let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => { fetchSpy = spyOn(globalThis, "fetch"); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });

describe("rows are untrusted input until they look like what the screen expects", () => {
  test("wiki: the real projection is read field by field; no id or title: skipped; wrong types: null, never coerced", () => {
    expect(toLocalWikiPage(wikiRow("w1"))).toEqual({ id: "w1", title: "Page w1", slug: "page-w1", content: "Body of w1", version: 2 });
    expect(toLocalWikiPage({ id: "w1" })).toBeNull();
    expect(toLocalWikiPage([])).toBeNull();
    const odd = toLocalWikiPage(wikiRow("w1", { version: "2", content: 7, slug: "" }))!;
    expect([odd.version, odd.content, odd.slug]).toEqual([null, null, null]);
    expect(toLocalWikiPage(wikiRow("w1"), new Set(["content"]))!.content).toBeNull(); // a field the role may not read is dropped
  });

  test("meetings: duration must be a whole number; a hidden field is dropped", () => {
    expect(toLocalMeeting(meetingRow("m1"))!.durationMinutes).toBe(45);
    expect(toLocalMeeting(meetingRow("m1", { duration_minutes: "45" }))!.durationMinutes).toBeNull();
    expect(toLocalMeeting(meetingRow("m1", { duration_minutes: -5 }))!.durationMinutes).toBeNull();
    expect(toLocalMeeting(meetingRow("m1"), new Set(["scheduled_at"]))!.scheduledAt).toBeNull();
    expect(toLocalMeeting({ title: "no id" })).toBeNull();
  });

  test("project: a row about another id is junk; a money figure the server nulled stays null and one it hid is dropped", () => {
    expect(toLocalProject(projectRow("p1"), "p1")!.projectValue).toBe(1500000);
    expect(toLocalProject(projectRow("p2"), "p1")).toBeNull();
    expect(toLocalProject(projectRow("p1", { project_value: null }), "p1")!.projectValue).toBeNull();
    expect(toLocalProject(projectRow("p1", { project_value: "1500000" }), "p1")!.projectValue).toBeNull();
    expect(toLocalProject(projectRow("p1"), "p1", new Set(["project_value"]))!.projectValue).toBeNull();
  });
});

describe("Wiki and Meetings are read from the laptop", () => {
  test("wiki list is ordered by title, junk skipped; one page by id, searched across projects", async () => {
    const idb = new IDBFactory();
    await seedPlatform(idb, "u1", [
      { projectId: "p1", data: wikiRow("w2", { title: "Zebra" }), kind: WIKI_KIND },
      { projectId: "p1", data: wikiRow("w1", { title: "Alpha" }), kind: WIKI_KIND },
      { projectId: "p1", data: { id: "junk" }, kind: WIKI_KIND },
      { projectId: "p2", data: wikiRow("w3", { title: "Other project" }), kind: WIKI_KIND },
    ], [WIKI_KIND], undefined, { done: ["p1", "p2"] });
    const list = await loadWikiList(shellData(idb), "p1");
    if (list.state !== "local") throw new Error(`expected local, got ${list.state}`);
    expect(list.rows.map((r) => r.id)).toEqual(["w1", "w2"]);
    const hit = await loadWikiObject(shellData(idb), "w3", null);
    expect(hit.state === "local" ? [hit.projectId, hit.item.title] : hit).toEqual(["p2", "Other project"]);
    expect((await loadWikiObject(shellData(idb), "w3", "p1")).state).toBe("not_found");
  });

  test("not copied / no project / another person's database each say a true thing", async () => {
    const idb = new IDBFactory();
    await seedPlatform(idb, "u1", [{ projectId: "p1", data: wikiRow("w1"), kind: WIKI_KIND }], [WIKI_KIND], undefined, { done: [] });
    expect(await loadWikiList(shellData(idb), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadWikiList(shellData(idb), null)).toEqual({ state: "no_project" });
    expect((await loadWikiObject({ ...shellData(idb), projects: [] }, "w1", null)).state).toBe("no_project");
    expect((await loadWikiList(shellData(idb, "u2"), "p1")).state).toBe("not_synced");
  });

  test("meetings: latest first, undated last", async () => {
    const idb = new IDBFactory();
    await seedPlatform(idb, "u1", [
      { projectId: "p1", data: meetingRow("m1"), kind: MEETINGS_KIND },
      { projectId: "p1", data: meetingRow("m3"), kind: MEETINGS_KIND },
      { projectId: "p1", data: meetingRow("m2", { scheduled_at: null }), kind: MEETINGS_KIND },
    ], [MEETINGS_KIND]);
    const list = await loadMeetingsList(shellData(idb), "p1");
    if (list.state !== "local") throw new Error(`expected local, got ${list.state}`);
    expect(list.rows.map((r) => r.id)).toEqual(["m3", "m1", "m2"]);
    const one = await loadMeetingObject(shellData(idb), "m1", "p1");
    expect(one.state === "local" ? one.item.durationMinutes : one).toBe(45);
    expect((await loadMeetingObject(shellData(idb), "nope", "p1")).state).toBe("not_found");
  });
});

describe("Projects, Workspace and Settings", () => {
  test("projects: details where copied, only the name where not; the stored value is printed in the base currency, never recomputed", async () => {
    const idb = new IDBFactory();
    await seedPlatform(idb, "u1", [
      { projectId: "p1", data: projectRow("p1", { name: "Cedar Heights" }), kind: PROJECT_KIND },
      { projectId: "p2", data: projectRow("p2", { name: "Annexe" }), kind: PROJECT_KIND },
    ], [PROJECT_KIND], { orgKinds: ["currencies"], rows: [{ kind: "currencies", data: { id: "c1", code: "INR", symbol: "R", is_base_currency: true } }] }, { done: ["p1"] });
    const result = await loadProjectsList(shellData(idb));
    if (result.state !== "local") throw new Error("expected local");
    expect(result.entries.map((e) => [e.id, e.name, e.project?.projectValue ?? "uncopied"])).toEqual([["p2", "Annexe Works", "uncopied"], ["p1", "Cedar Heights", 1500000]]);
    expect(result.currency?.code).toBe("INR");
    expect((await loadProjectsList({ ...shellData(idb), projects: [] })).state).toBe("no_project");
  });

  test("workspace: a project this person does not have is not found; one they have shows its facts", async () => {
    const idb = new IDBFactory();
    await seedPlatform(idb, "u1", [{ projectId: "p1", data: projectRow("p1", { name: "Cedar Heights" }), kind: PROJECT_KIND }], [PROJECT_KIND]);
    expect(await loadWorkspace(shellData(idb), "elsewhere")).toEqual({ state: "not_found", projectId: "elsewhere" });
    const ws = await loadWorkspace(shellData(idb), "p1");
    expect(ws.state === "local" ? [ws.name, ws.project?.status] : ws).toEqual(["Cedar Heights", "active"]);
  });

  test("workspace sections are exactly the online page's per-role list, each carrying the project", () => {
    const keys = (role: string | null) => workspaceLinks(role, "p 1").map((l) => l.key);
    expect(keys("pm")).toHaveLength(11);
    expect(keys("site_engineer")).toEqual(["progress", "site-diary", "timeline", "milestones", "rfis", "resources", "records"]);
    expect(keys("client_viewer")).toEqual(["boq", "timeline", "milestones", "scope-change-orders", "billing-milestones"]);
    expect(keys("member")).not.toContain("site-diary");
    expect(keys(null)).toEqual([]);
    expect(keys("someone_new")).toEqual([]);
    expect(workspaceLinks("pm", "p 1")[0]!.href).toBe("/work-progress?projectId=p%201");
  });

  test("settings: lists the role may read are shown; a kind the manifest does not list is 'not_allowed', never empty", async () => {
    const idb = new IDBFactory();
    await seedPlatform(idb, "u1", [{ projectId: "p1", data: projectRow("p1"), kind: PROJECT_KIND }], [PROJECT_KIND], {
      orgKinds: ["currencies", "boq_categories", "org_people"],
      rows: [
        { kind: "currencies", data: { id: "c1", code: "AED", name: "UAE Dirham", is_base_currency: true } },
        { kind: "boq_categories", data: { id: "b1", name: "Civil", sort_order: 2, is_active: true } },
        { kind: "boq_categories", data: { id: "b2", name: "Finishes", sort_order: 1, is_active: true } },
        { kind: "org_people", data: { id: "u9", name: "Zed", role: "member", is_active: false, email: "z***@x.test" } },
        { kind: "org_people", data: { id: "u8", name: "Ann", role: "pm", is_active: true, email: "a***@x.test" } },
        { kind: "org_people", data: { id: "u7", name: "  ", role: "pm" } },
      ],
    });
    const s = await loadSettings(shellData(idb));
    expect(s.currency).toEqual({ state: "local", value: { id: "c1", code: "AED", name: "UAE Dirham", symbol: null } });
    expect(s.categories).toEqual({ state: "local", value: ["Finishes", "Civil"] });
    expect(s.team.state === "local" ? s.team.value.map((m) => [m.name, m.role, m.active]) : s.team).toEqual([["Ann", "pm", true], ["Zed", "member", false]]);
    expect(JSON.stringify(s.team)).not.toContain("x.test"); // teammates' e-mail addresses are never carried into the screen
    expect([s.name, s.role, s.projectCount]).toEqual(["Asha", "pm", 2]);

    const viewerIdb = new IDBFactory();
    await seedPlatform(viewerIdb, "u1", [{ projectId: "p1", data: projectRow("p1"), kind: PROJECT_KIND }], [PROJECT_KIND], { orgKinds: ["cost_visibility"], rows: [] });
    const v = await loadSettings(shellData(viewerIdb));
    expect([v.currency, v.categories, v.team]).toEqual([{ state: "not_allowed" }, { state: "not_allowed" }, { state: "not_allowed" }]);
  });
});
