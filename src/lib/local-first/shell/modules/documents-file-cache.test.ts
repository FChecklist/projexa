import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { DEFAULT_FILE_CAPS, deleteFileCache, fetchDocumentFile, fileDbNameFor, openFileCache, signingRoute } from "./documents-file-cache";

// Small caps keep the test light; the real ones are DEFAULT_FILE_CAPS (asserted at the end).
const caps = { pinned: 500, recent: 150, maxFile: 60 };
const bytes = (size: number, fill = 1) => new Uint8Array(size).fill(fill).buffer;
const owner = { orgId: "orgA", projectId: "p1" };
const file = (docId: string, size: number, pinned = false, over: Record<string, unknown> = {}) => ({ docId, ...owner, name: `${docId}.pdf`, type: "application/pdf", bytes: bytes(size), pinned, ...over });

function clock(start = 1000) {
  let t = start;
  return { now: () => (t += 1) };
}

describe("the file cache: kept per person, size-capped, never another organisation's or project's", () => {
  test("a kept file is read back with its bytes and type; reading marks it as just opened", async () => {
    const idb = new IDBFactory();
    const cache = await openFileCache("u1", { idb, ...clock() });
    expect(await cache.put(file("d1", 1024))).toEqual({ ok: true });
    const got = await cache.get("d1", owner);
    expect(got).toMatchObject({ docId: "d1", name: "d1.pdf", type: "application/pdf", size: 1024, pinned: false });
    expect(new Uint8Array(got!.bytes)[0]).toBe(1);
    cache.close();
  });

  test("a file kept for another organisation or project is never handed out", async () => {
    const idb = new IDBFactory();
    const cache = await openFileCache("u1", { idb });
    await cache.put(file("d1", 10));
    expect(await cache.get("d1", { orgId: "orgB", projectId: "p1" })).toBeNull();
    expect(await cache.get("d1", { orgId: "orgA", projectId: "p2" })).toBeNull();
    cache.close();
  });

  test("each person has their own cache: another person's kept files contribute nothing", async () => {
    const idb = new IDBFactory();
    const a = await openFileCache("u1", { idb });
    await a.put(file("d1", 10));
    a.close();
    const b = await openFileCache("u2", { idb });
    expect(await b.get("d1", owner)).toBeNull();
    expect(await b.list()).toEqual([]);
    b.close();
  });

  test("recent files beyond the cap: the least recently OPENED go first; pinned files are never dropped", async () => {
    const idb = new IDBFactory();
    const cache = await openFileCache("u1", { idb, caps, ...clock() });
    const third = 50;
    await cache.put(file("old", third));
    await cache.put(file("mid", third));
    await cache.put(file("pin", 40, true));
    await cache.get("old", owner); // opened again: now the most recent
    await cache.put(file("new", third + 10)); // pushes the recent total past the cap
    expect((await cache.list()).map((f) => f.docId).sort()).toEqual(["new", "old", "pin"]);
    cache.close();
  });

  test("a file over the per-file limit, an empty file, or past the pinned cap is refused with a plain message", async () => {
    const idb = new IDBFactory();
    const cache = await openFileCache("u1", { idb, caps });
    expect((await cache.put(file("big", 61))).ok).toBe(false);
    expect((await cache.put(file("empty", 0))).ok).toBe(false);
    for (let i = 0; i < 9; i += 1) expect((await cache.put(file(`p${i}`, 55, true))).ok).toBe(true); // 495 pinned
    const refused = await cache.put(file("p9", 10, true));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("Remove a kept file first");
    cache.close();
  });

  test("keeping a file again keeps it pinned; unpinning makes it an ordinary recent file", async () => {
    const idb = new IDBFactory();
    const cache = await openFileCache("u1", { idb });
    await cache.put(file("d1", 10, true));
    await cache.put(file("d1", 12, false)); // re-opened online later: still pinned
    expect((await cache.list())[0]).toMatchObject({ docId: "d1", pinned: true, size: 12 });
    await cache.setPinned("d1", false);
    expect((await cache.list())[0]!.pinned).toBe(false);
    cache.close();
  });

  test("prune drops files whose document is no longer on the laptop (deleted, or no longer visible to this person)", async () => {
    const idb = new IDBFactory();
    const cache = await openFileCache("u1", { idb });
    await cache.put(file("keep", 10));
    await cache.put(file("gone", 10, true));
    await cache.put(file("other-project", 10, false, { projectId: "p2" }));
    expect(await cache.prune(new Set(["keep"]), owner)).toBe(1);
    expect((await cache.list()).map((f) => f.docId).sort()).toEqual(["keep", "other-project"]);
    cache.close();
  });

  test("sign-out removes the person's whole file database", async () => {
    const idb = new IDBFactory();
    const cache = await openFileCache("u1", { idb });
    await cache.put(file("d1", 10));
    cache.close();
    await deleteFileCache("u1", idb);
    const names = (await idb.databases()).map((d) => d.name);
    expect(names).not.toContain(fileDbNameFor("u1"));
  });
});

test("the real caps: 500 MB kept on purpose, 150 MB of recent files, 60 MB per file", () => {
  expect(DEFAULT_FILE_CAPS).toEqual({ pinned: 500 * 1024 * 1024, recent: 150 * 1024 * 1024, maxFile: 60 * 1024 * 1024 });
});

describe("fetching a file (online only) goes through the online screens' own signing routes", () => {
  test("the route per module", () => {
    expect(signingRoute({ module: "documents", docId: "a/b" })).toBe("/api/documents/a%2Fb");
    expect(signingRoute({ module: "drawings", docId: "d1" })).toBe("/api/drawings/d1/document-url");
    expect(signingRoute({ module: "permits", docId: "p1" })).toBe("/api/permits/p1");
  });

  test("signed URL then bytes; the content type is kept", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (String(input) === "/api/documents/d1") return Response.json({ signedUrl: "https://storage.test/signed/d1?token=t" });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png; charset=binary" } });
    }) as typeof fetch;
    const got = await fetchDocumentFile({ module: "documents", docId: "d1" }, { fetchImpl });
    expect(got.kind).toBe("file");
    if (got.kind === "file") expect([got.type, got.bytes.byteLength]).toEqual(["image/png", 3]);
    expect(calls).toEqual(["/api/documents/d1", "https://storage.test/signed/d1?token=t"]);
  });

  test("an external link is never downloaded (the server says so, or the laptop's row does)", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({ documentUrl: "https://viewer.test/walkthrough", isExternalLink: String(input).includes("drawings") });
    }) as typeof fetch;
    expect(await fetchDocumentFile({ module: "drawings", docId: "d1" }, { fetchImpl })).toEqual({ kind: "external", url: "https://viewer.test/walkthrough" });
    expect(await fetchDocumentFile({ module: "permits", docId: "p1", external: true }, { fetchImpl })).toEqual({ kind: "external", url: "https://viewer.test/walkthrough" });
    expect(calls).toEqual(["/api/drawings/d1/document-url", "/api/permits/p1"]);
  });

  test("refused, failing, no URL, or no network: a plain message, never a throw", async () => {
    const answer = (res: Response | Error) => (async () => { if (res instanceof Error) throw res; return res; }) as unknown as typeof fetch;
    expect((await fetchDocumentFile({ module: "documents", docId: "d1" }, { fetchImpl: answer(new Response("", { status: 403 })) })).kind).toBe("none");
    expect((await fetchDocumentFile({ module: "documents", docId: "d1" }, { fetchImpl: answer(new Response("", { status: 503 })) })).kind).toBe("none");
    expect((await fetchDocumentFile({ module: "documents", docId: "d1" }, { fetchImpl: answer(Response.json({})) })).kind).toBe("none");
    expect((await fetchDocumentFile({ module: "documents", docId: "d1" }, { fetchImpl: answer(new TypeError("Failed to fetch")) })).kind).toBe("none");
  });
});
