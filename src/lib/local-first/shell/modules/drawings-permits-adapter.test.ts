import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { loadDrawingObject, loadDrawingsList } from "./drawings-adapter";
import { daysToExpiry, loadPermitObject, loadPermitsList } from "./permits-adapter";
import { docRow, seedPerson, shellData } from "./documents-test-fixtures";

const NOW = Date.parse("2026-05-01T00:00:00Z");

function drawing(id: string, meta: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return docRow(id, { category: "drawing", name: `Plan ${id}`, metadata: meta, ...over });
}

function permit(id: string, meta: Record<string, unknown>, expiry: string | null, over: Record<string, unknown> = {}) {
  return docRow(id, { category: "permit", name: `Permit ${id}`, expiry_date: expiry, metadata: meta, ...over });
}

async function seedRegister(idb: IDBFactory) {
  await seedPerson(idb, "u1", [
    { projectId: "p1", data: drawing("d1", { drawingNo: "A-101", rev: "A", status: "superseded" }, { created_at: "2026-01-01T00:00:00Z" }) },
    { projectId: "p1", data: drawing("d2", { drawingNo: "A-101", rev: "B", status: "superseded", supersedesId: "d1" }, { created_at: "2026-02-01T00:00:00Z" }) },
    { projectId: "p1", data: drawing("d3", { rev: "C", status: "current", supersedesId: "d2" }, { created_at: "2026-03-01T00:00:00Z" }) }, // number dropped, still linked
    { projectId: "p1", data: drawing("d4", { drawingNo: "S-200" }, { category: "drawing_3d", created_at: "2026-01-05T00:00:00Z" }) },
    { projectId: "p1", data: docRow("x1", { category: "contract" }) },
    { projectId: "p1", data: permit("pm1", { permitNumber: "BP-7", permitAuthority: "Municipality", issueDate: "2026-01-01" }, "2026-05-11T00:00:00Z") },
    { projectId: "p1", data: permit("pm2", {}, "2026-04-20T00:00:00Z") },
    { projectId: "p1", data: permit("pm3", {}, null) },
    { projectId: "p1", data: permit("pm4", {}, "2026-09-01T00:00:00Z") },
  ]);
}

describe("the drawing register, read from the laptop", () => {
  test("only drawings (both kinds), in register order, with the app's own status words; no status reads 'For approval', never 'Current'", async () => {
    const idb = new IDBFactory();
    await seedRegister(idb);
    const result = await loadDrawingsList(shellData(idb), "p1");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.rows.map((r) => [r.id, r.kindLabel, r.status])).toEqual([
      ["d2", "DWG", "superseded"],
      ["d1", "DWG", "superseded"],
      ["d4", "3D Walkthrough", "for_approval"],
      ["d3", "DWG", "current"],
    ]);
  });

  test("one drawing: what it supersedes and its whole revision chain, newest first, linked by supersedesId or drawing number", async () => {
    const idb = new IDBFactory();
    await seedRegister(idb);
    const result = await loadDrawingObject(shellData(idb), "d3", "p1");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.supersedes?.id).toBe("d2");
    expect(result.history.map((d) => d.meta.rev)).toEqual(["C", "B", "A"]);
    // From the OLDEST revision: the later ones are found through the links that point back at it (d3 has no drawing number).
    const oldest = await loadDrawingObject(shellData(idb), "d1", "p1");
    if (oldest.state !== "local") throw new Error("unreachable");
    expect(oldest.history.map((d) => d.id)).toEqual(["d3", "d2", "d1"]);
    const lone = await loadDrawingObject(shellData(idb), "d4", "p1");
    if (lone.state !== "local") throw new Error("unreachable");
    expect(lone.supersedes).toBeNull();
    expect(lone.history.map((d) => d.id)).toEqual(["d4"]);
  });

  test("a document that is not a drawing is not opened as one; not synced / no project are said plainly", async () => {
    const idb = new IDBFactory();
    await seedRegister(idb);
    expect(await loadDrawingObject(shellData(idb), "x1", "p1")).toEqual({ state: "not_found", projectId: "p1" });
    expect(await loadDrawingsList(shellData(idb), "p2")).toEqual({ state: "not_synced", projectId: "p2" });
    expect(await loadDrawingsList(shellData(idb), null)).toEqual({ state: "no_project" });
  });

  test("another person's register on the same laptop contributes nothing", async () => {
    const idb = new IDBFactory();
    await seedRegister(idb);
    expect(await loadDrawingsList(shellData(idb, "u2"), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
  });
});

describe("the permits, read from the laptop", () => {
  test("days to expiry are computed as the server computes them (ceil of days from now)", () => {
    expect(daysToExpiry("2026-05-11T00:00:00Z", NOW)).toBe(10);
    expect(daysToExpiry("2026-05-01T06:00:00Z", NOW)).toBe(1);
    expect(daysToExpiry("2026-04-20T00:00:00Z", NOW)).toBe(-11);
    expect(daysToExpiry(null, NOW)).toBeNull();
    expect(daysToExpiry("not a date", NOW)).toBeNull();
  });

  test("only permits, soonest end date first, no end date last; number/authority/issue date from the synced metadata", async () => {
    const idb = new IDBFactory();
    await seedRegister(idb);
    const result = await loadPermitsList(shellData(idb), "p1", null, NOW);
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.rows.map((r) => [r.id, r.daysToExpiry])).toEqual([["pm2", -11], ["pm1", 10], ["pm4", 123], ["pm3", null]]);
    expect(result.rows[1]).toMatchObject({ permitNumber: "BP-7", permitAuthority: "Municipality", issueDate: "2026-01-01", endDate: "2026-05-11T00:00:00Z" });
  });

  test("?withinDays=30 keeps permits ending within 30 days, expired ones included (the server's lte(expiry, now + days)); junk is ignored", async () => {
    const idb = new IDBFactory();
    await seedRegister(idb);
    const within = await loadPermitsList(shellData(idb), "p1", "30", NOW);
    if (within.state !== "local") throw new Error("unreachable");
    expect(within.rows.map((r) => r.id)).toEqual(["pm2", "pm1"]);
    const junk = await loadPermitsList(shellData(idb), "p1", "30; drop", NOW);
    if (junk.state !== "local") throw new Error("unreachable");
    expect(junk.withinDays).toBeNull();
    expect(junk.rows).toHaveLength(4);
  });

  test("one permit by id; a drawing id is not a permit", async () => {
    const idb = new IDBFactory();
    await seedRegister(idb);
    const result = await loadPermitObject(shellData(idb), "pm1", null, NOW);
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.permit).toMatchObject({ id: "pm1", projectId: "p1", daysToExpiry: 10 });
    expect((await loadPermitObject(shellData(idb), "d1", "p1", NOW)).state).toBe("not_found");
  });
});
