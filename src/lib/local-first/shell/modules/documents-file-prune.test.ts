import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openFileCache } from "./documents-file-cache";
import { pruneKeptFiles } from "./documents-file-prune";
import { docRow, seedPerson, shellData } from "./documents-test-fixtures";

const keep = (docId: string, projectId = "p1") => ({ docId, orgId: "orgA", projectId, name: docId, type: "application/pdf", bytes: new Uint8Array([1]).buffer, pinned: true });

async function kept(idb: IDBFactory) {
  const cache = await openFileCache("u1", { idb: idb as never });
  const ids = (await cache.list()).map((f) => f.docId).sort();
  cache.close();
  return ids;
}

describe("kept files follow the documents on the laptop", () => {
  test("a kept file whose document is gone from the project (deleted, or no longer visible) is dropped; others stay", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: docRow("d1") }]);
    const cache = await openFileCache("u1", { idb: idb as never });
    await cache.put(keep("d1"));
    await cache.put(keep("revoked"));
    await cache.put(keep("x9", "p2"));
    cache.close();
    expect(await pruneKeptFiles(shellData(idb), "p1")).toBe(1);
    expect(await kept(idb)).toEqual(["d1", "x9"]);
  });

  test("a project that has not finished copying is left alone (a partial copy proves nothing)", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p2", data: docRow("d1", { linked_entity_id: "p2" }) }], { done: ["p1"] });
    const cache = await openFileCache("u1", { idb: idb as never });
    await cache.put(keep("other", "p2"));
    cache.close();
    expect(await pruneKeptFiles(shellData(idb), "p2")).toBe(0);
    expect(await kept(idb)).toEqual(["other"]);
  });
});
