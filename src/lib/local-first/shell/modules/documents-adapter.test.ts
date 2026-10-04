import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { readProjectDocuments, toLocalDocument } from "./documents-records";
import { loadDocumentObject, loadDocumentsList } from "./documents-adapter";
import { docRow, seedPerson, shellData } from "./documents-test-fixtures";

describe("a replica row is untrusted input until it looks like a document", () => {
  test("the real projection is read field by field, metadata keys included", () => {
    const doc = toLocalDocument(docRow("d1", { metadata: { drawingNo: "A-101", rev: "B", status: "current", discipline: "Architectural", supersedesId: "d0", isExternalLink: "false" } }), "p1");
    expect(doc).toMatchObject({
      id: "d1", projectId: "p1", name: "Doc d1", category: "contract", fileType: "application/pdf", fileSize: 2048, versionNumber: 1, isLatestVersion: true,
      isExternalLink: false, meta: { drawingNo: "A-101", rev: "B", status: "current", discipline: "Architectural", supersedesId: "d0", permitNumber: null }, waiting: false,
    });
  });

  test("rows without an id or a name, of another project, or not linked to a project are skipped", () => {
    expect(toLocalDocument({ name: "x", linked_entity_type: "project", linked_entity_id: "p1" }, "p1")).toBeNull();
    expect(toLocalDocument(docRow("d1", { name: "" }), "p1")).toBeNull();
    expect(toLocalDocument(docRow("d1", { linked_entity_id: "p2" }), "p1")).toBeNull();
    expect(toLocalDocument(docRow("d1", { linked_entity_type: "rfi" }), "p1")).toBeNull();
    expect(toLocalDocument("junk", "p1")).toBeNull();
    expect(toLocalDocument(null, "p1")).toBeNull();
  });

  test("a value of the wrong type is shown as 'not on this laptop' (null), never coerced into something invented", () => {
    const doc = toLocalDocument(docRow("d1", { file_size: { evil: 1 }, version_number: "abc", is_latest_version: "maybe", metadata: ["not", "an", "object"] }), "p1")!;
    expect(doc.fileSize).toBeNull();
    expect(doc.versionNumber).toBeNull();
    expect(doc.isLatestVersion).toBeNull();
    expect(doc.meta.drawingNo).toBeNull();
  });

  test("a field the sync service hid for this person's role is never shown, even if a row still carries it", () => {
    const doc = toLocalDocument(docRow("d1", { file_size: 999, metadata: { permitNumber: "P-1" } }), "p1", new Set(["file_size", "metadata"]))!;
    expect(doc.fileSize).toBeNull();
    expect(doc.meta.permitNumber).toBeNull();
  });
});

describe("the Documents list, read from the laptop", () => {
  test("a synced project's documents, newest first, junk skipped", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [
      { projectId: "p1", data: docRow("d1") },
      { projectId: "p1", data: docRow("d3", { category: "drawing" }) },
      { projectId: "p1", data: { id: "junk" } },
      { projectId: "p2", data: docRow("d9", { linked_entity_id: "p2" }) },
    ]);
    const result = await loadDocumentsList(shellData(idb), "p1");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.rows.map((r) => r.id)).toEqual(["d3", "d1"]);
    expect(result.syncedAt).toBe(1_760_000_000_000);
  });

  test("not copied to the end yet: 'not_synced', never a partial list; no project: 'no_project'", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p2", data: docRow("d9", { linked_entity_id: "p2" }) }], { done: ["p1"] });
    expect(await loadDocumentsList(shellData(idb), "p2")).toEqual({ state: "not_synced", projectId: "p2" });
    expect(await loadDocumentsList(shellData(idb), null)).toEqual({ state: "no_project" });
  });

  test("another person's database on the same laptop contributes nothing", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "someone-else", [{ projectId: "p1", data: docRow("d1") }]);
    expect(await loadDocumentsList(shellData(idb, "u1"), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
  });

  test("rows stored under another organisation are not read", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: docRow("d1") }, { projectId: "p1", data: docRow("d2"), orgId: "orgB" }]);
    const result = await loadDocumentsList(shellData(idb), "p1");
    if (result.state !== "local") throw new Error("unreachable");
    expect(result.rows.map((r) => r.id)).toEqual(["d1"]);
  });

  test("a viewer-role person: the fields the sync marked hidden for their role are not in what the screen gets", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: docRow("d1", { file_size: 777, metadata: { permitNumber: "P-9" } }) }], { hiddenFields: ["file_size", "metadata"] });
    const result = await loadDocumentsList(shellData(idb, "u1", "orgA", "viewer"), "p1");
    if (result.state !== "local") throw new Error("unreachable");
    expect(result.rows[0]!.fileSize).toBeNull();
    expect(result.rows[0]!.meta.permitNumber).toBeNull();
    expect(JSON.stringify(result)).not.toContain("777");
    expect(JSON.stringify(result)).not.toContain("P-9");
  });

  test("a row with an edit waiting to be sent is marked as waiting", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: docRow("d1"), dirty: "op-1" }, { projectId: "p1", data: docRow("d2") }]);
    const { docs } = await readProjectDocuments(shellData(idb), "p1");
    expect(docs.map((d) => [d.id, d.waiting])).toEqual([["d1", true], ["d2", false]]);
  });
});

describe("one document, read from the laptop", () => {
  test("found in the URL's project, with the other versions of the same name (highest version first)", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [
      { projectId: "p1", data: docRow("d1", { name: "Contract", version_number: 1, is_latest_version: false }) },
      { projectId: "p1", data: docRow("d2", { name: "Contract", version_number: 2 }) },
      { projectId: "p1", data: docRow("d3", { name: "Other" }) },
    ]);
    const result = await loadDocumentObject(shellData(idb), "d2", "p1");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.doc.id).toBe("d2");
    expect(result.sameName.map((d) => d.id)).toEqual(["d1"]);
  });

  test("with no project in the URL, the person's projects are searched", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p2", data: docRow("d9", { linked_entity_id: "p2" }) }], { done: ["p1", "p2"] });
    const result = await loadDocumentObject(shellData(idb), "d9", null);
    expect(result.state).toBe("local");
    if (result.state === "local") expect(result.projectId).toBe("p2");
  });

  test("not on the laptop: 'not_found' when a project was synced, 'not_synced' when none was", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: docRow("d1") }]);
    expect(await loadDocumentObject(shellData(idb), "nope", "p1")).toEqual({ state: "not_found", projectId: "p1" });
    expect(await loadDocumentObject(shellData(new IDBFactory()), "d1", "p1")).toEqual({ state: "not_synced", projectId: "p1" });
  });
});
