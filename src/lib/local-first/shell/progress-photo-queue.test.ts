import { describe, expect, test } from "bun:test";
import { FakeMeta } from "../release/__fixtures__/fakes";
import { MAX_PHOTO_BYTES, PHOTO_JOBS_META_KEY, PhotoUploadError, createPhotoQueue, type PhotoUploader } from "./progress-photo-queue";

// R-48 on the laptop-first screen: a photo for a progress entry is kept as a follow-up job tied to the entry's outbox op, uploaded to the SAME
// /api/work-progress/photos route once the outbox says the entry reached the server, and never dropped without a notice.

const jpg = () => new Blob(["photo-bytes"], { type: "image/jpeg" });
function setup(upload: PhotoUploader = async () => {}) {
  const meta = new FakeMeta();
  const log: string[] = [];
  let n = 0;
  const queue = createPhotoQueue({ meta, upload: async (id, b, name) => { log.push(`upload:${id}:${name}`); return upload(id, b, name); }, now: () => 1_760_000_000_000, newId: () => `ph-${++n}` });
  return { meta, queue, log };
}
type Q = ReturnType<typeof setup>["queue"];
const add = (queue: Q, over: Partial<Parameters<Q["add"]>[0]> = {}) => queue.add({ opId: "op-1", projectId: "p1", file: jpg(), fileName: "slab.jpg", ...over });

describe("a photo is kept on the laptop and waits for its entry", () => {
  test("add keeps the bytes at once, in state waiting_entry, and sends nothing", async () => {
    const { queue, meta, log } = setup();
    const job = await add(queue);
    expect(job).toMatchObject({ opId: "op-1", fileName: "slab.jpg", contentType: "image/jpeg", state: "waiting_entry", attempts: 0 });
    expect(meta.data.get("shell:progress-photo-blob:ph-1")).toBeInstanceOf(Blob);
    expect(await queue.flush()).toMatchObject({ sent: 0, kept: 1, stoppedBecause: "none" });
    expect(log).toEqual([]);
  });

  test("an empty photo, one over the cap and a nameless one are not kept", async () => {
    const { queue } = setup();
    expect(await add(queue, { file: new Blob([]) })).toBeNull();
    expect(await add(queue, { file: { size: MAX_PHOTO_BYTES + 1, type: "image/jpeg" } as unknown as Blob })).toBeNull();
    expect(await add(queue, { fileName: " " })).toBeNull();
    expect(await queue.list()).toEqual([]);
  });
});

describe("once the entry has reached the server, the photo is attached to the server's id", () => {
  test("entryApplied then flush uploads for that id, then the job and its bytes are gone", async () => {
    const { queue, meta, log } = setup();
    await add(queue);
    await queue.entryApplied("op-1", "entry-77");
    const r = await queue.flush();
    expect(log).toEqual(["upload:entry-77:slab.jpg"]);
    expect(r).toMatchObject({ sent: 1, dropped: 0, kept: 0 });
    expect(await queue.list()).toEqual([]);
    expect(meta.data.get("shell:progress-photo-blob:ph-1")).toBeUndefined();
  });

  test("an entry applied BEFORE its photo was kept (a fast online send) still gets the photo, as ready", async () => {
    const { queue, log } = setup();
    await queue.entryApplied("op-1", "entry-5");
    const job = await add(queue);
    expect(job).toMatchObject({ state: "ready", entryId: "entry-5" });
    await queue.flush();
    expect(log).toEqual(["upload:entry-5:slab.jpg"]);
  });

  test("an entry applied for a different op leaves this photo waiting", async () => {
    const { queue, log } = setup();
    await add(queue);
    await queue.entryApplied("op-OTHER", "entry-9");
    await queue.flush();
    expect(log).toEqual([]);
    expect((await queue.list())[0]!.state).toBe("waiting_entry");
  });

  test("the job survives a reload (it is stored, not held in memory)", async () => {
    const { queue, meta } = setup();
    await add(queue);
    const again = createPhotoQueue({ meta, upload: async () => {} });
    expect(await again.list()).toHaveLength(1);
    expect((meta.data.get(PHOTO_JOBS_META_KEY) as unknown[]).length).toBe(1);
  });
});

describe("failures keep or tell, never silently drop", () => {
  test("offline keeps the photo ready and stops", async () => {
    const { queue } = setup(async () => { throw new TypeError("Failed to fetch"); });
    await add(queue);
    await queue.entryApplied("op-1", "e1");
    const r = await queue.flush();
    expect(r).toMatchObject({ sent: 0, kept: 1, stoppedBecause: "offline" });
    expect((await queue.list())[0]).toMatchObject({ state: "ready", entryId: "e1" });
    expect(await queue.notices()).toEqual([]);
  });

  test("a 5xx keeps it and counts the attempt; a 401 keeps it as signed out", async () => {
    const a = setup(async () => { throw new PhotoUploadError(502, "bad gateway"); });
    await add(a.queue);
    await a.queue.entryApplied("op-1", "e1");
    expect(await a.queue.flush()).toMatchObject({ kept: 1, stoppedBecause: "server" });
    expect((await a.queue.list())[0]!.attempts).toBe(1);
    const b = setup(async () => { throw new PhotoUploadError(401, "no"); });
    await add(b.queue);
    await b.queue.entryApplied("op-1", "e1");
    expect(await b.queue.flush()).toMatchObject({ kept: 1, stoppedBecause: "signed_out" });
  });

  test("a real refusal drops the photo WITH a notice in words", async () => {
    const { queue } = setup(async () => { throw new PhotoUploadError(415, "file type not allowed"); });
    await add(queue);
    await queue.entryApplied("op-1", "e1");
    const r = await queue.flush();
    expect(r).toMatchObject({ sent: 0, dropped: 1, kept: 0 });
    const notes = await queue.notices();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message).toContain("file type not allowed");
    expect(notes[0]!.message).toContain("progress entry itself was saved");
  });

  test("an entry the server turned down drops its photo with a notice", async () => {
    const { queue, meta } = setup();
    await add(queue);
    await queue.entryRejected("op-1");
    expect(await queue.list()).toEqual([]);
    expect(meta.data.get("shell:progress-photo-blob:ph-1")).toBeUndefined();
    expect((await queue.notices())[0]!.message).toContain("did not accept the progress entry");
  });

  test("missing bytes are reported, not skipped", async () => {
    const { queue, meta } = setup();
    await add(queue);
    await queue.entryApplied("op-1", "e1");
    meta.data.delete("shell:progress-photo-blob:ph-1");
    expect(await queue.flush()).toMatchObject({ dropped: 1 });
    expect((await queue.notices())[0]!.message).toContain("no longer on this laptop");
  });
});
