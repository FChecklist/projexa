import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { MEETING_MINUTES_KIND, isPublished, loadMomObject, loadMomsList, toLocalMom } from "./moms-adapter";
import { momRow, seedPerson, shellData } from "./documents-test-fixtures";

const KINDS = { kinds: [MEETING_MINUTES_KIND] };

describe("a meeting_minutes row is untrusted input until it looks like a MoM", () => {
  test("the real projection is read field by field; the agenda is one item per line", () => {
    expect(toLocalMom(momRow("m1"), "p1")).toEqual({
      id: "m1", projectId: "p1", title: "Meeting m1", meetingType: "team", scheduledAt: "2026-04-01T09:00:00Z", status: "draft", publishedAt: null,
      agenda: ["1. Progress", "2. Safety"], minutes: "Agreed to pour slab on Monday.", attendeeCount: 4, createdAt: "2026-04-01T08:00:00Z", waiting: false,
    });
    expect(toLocalMom(momRow("m1", { agenda: ["a", 3, { x: 1 }, " b "] }), "p1")!.agenda).toEqual(["a", "b"]);
  });

  test("no id or title: skipped; wrong types: shown as not on this laptop (null), never coerced", () => {
    expect(toLocalMom({ id: "m1" }, "p1")).toBeNull();
    expect(toLocalMom([], "p1")).toBeNull();
    const m = toLocalMom(momRow("m1", { attendee_count: "4", minutes: 12, agenda: { a: 1 } }), "p1")!;
    expect([m.attendeeCount, m.minutes, m.agenda]).toEqual([null, null, null]);
  });

  test("a hidden field (role) is dropped", () => {
    expect(toLocalMom(momRow("m1"), "p1", new Set(["minutes"]))!.minutes).toBeNull();
  });

  test("published = status published or a publish time", () => {
    expect(isPublished({ status: "published", publishedAt: null })).toBe(true);
    expect(isPublished({ status: "draft", publishedAt: "2026-04-01T00:00:00Z" })).toBe(true);
    expect(isPublished({ status: "draft", publishedAt: null })).toBe(false);
  });
});

describe("the MoM list and one MoM, read from the laptop", () => {
  test("latest meeting first, undated last, junk skipped", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [
      { projectId: "p1", data: momRow("m1") },
      { projectId: "p1", data: momRow("m3") },
      { projectId: "p1", data: momRow("m2", { scheduled_at: null }) },
      { projectId: "p1", data: { id: "junk" } },
    ], KINDS);
    const result = await loadMomsList(shellData(idb), "p1");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.rows.map((r) => r.id)).toEqual(["m3", "m1", "m2"]);
  });

  test("not synced / no project / another person's database", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: momRow("m1") }], KINDS);
    expect(await loadMomsList(shellData(idb), "p2")).toEqual({ state: "not_synced", projectId: "p2" });
    expect(await loadMomsList(shellData(idb), null)).toEqual({ state: "no_project" });
    expect(await loadMomsList(shellData(idb, "u2"), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
  });

  test("one MoM by id (searched across the person's projects without ?projectId=), with its waiting mark", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p2", data: momRow("m9"), dirty: "op-7" }], { ...KINDS, done: ["p1", "p2"] });
    const result = await loadMomObject(shellData(idb), "m9", null);
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.projectId).toBe("p2");
    expect(result.mom.waiting).toBe(true);
    expect(await loadMomObject(shellData(idb), "nope", "p1")).toEqual({ state: "not_found", projectId: "p1" });
  });

  test("a `documents` row with the same id is never read as a MoM (each kind is read on its own)", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: momRow("m1"), kind: "documents" }], { kinds: [MEETING_MINUTES_KIND, "documents"] });
    expect(await loadMomObject(shellData(idb), "m1", "p1")).toEqual({ state: "not_found", projectId: "p1" });
  });
});
