import { describe, expect, test } from "bun:test";
import { FakeMeta } from "../release/__fixtures__/fakes";
import { FILE_JOBS_META_KEY, MAX_FILE_BYTES, UploadError, createFileQueue, notConfiguredUploader, type FileJob, type UploadPort } from "./file-queue";

// A file is a record AND bytes: the bytes must be up BEFORE the record (create_permit / create_drawing / create_document take externalUrl).
// Everything real here except the transport and the outbox, which are recorders.

const pdf = (text = "%PDF-1.4 permit") => new Blob([text], { type: "application/pdf" });
const input = (over: Partial<Parameters<ReturnType<typeof createFileQueue>["add"]>[0]> = {}) => ({
  kind: "permit" as const, projectId: "p1", fields: { name: "Fit-out permit", permitNumber: "FP-1" }, file: pdf(), fileName: "fitout.pdf", ...over,
});

function setup(upload: UploadPort["upload"] = async () => ({ externalUrl: "https://storage.example/x.pdf" }), enqueue: (j: FileJob & { externalUrl: string }) => Promise<void> = async () => {}) {
  const meta = new FakeMeta();
  const log: string[] = [];
  let n = 0;
  const queue = createFileQueue({
    meta,
    uploader: { upload: async (j, b, s) => { log.push(`upload:${j.fileName}`); return upload(j, b, s); } },
    enqueueRecord: async (j) => { log.push(`record:${j.fileName}:${j.externalUrl}`); await enqueue(j); },
    now: () => 1_760_000_000_000,
    newId: () => `job-${++n}`,
  });
  return { meta, queue, log };
}

describe("a file is kept on the laptop with what the person typed", () => {
  test("add keeps the bytes and the fields at once and sends nothing", async () => {
    const { queue, meta, log } = setup();
    const job = await queue.add(input());
    expect(job).toMatchObject({ id: "job-1", kind: "permit", projectId: "p1", fileName: "fitout.pdf", contentType: "application/pdf", state: "waiting", attempts: 0, fields: { name: "Fit-out permit", permitNumber: "FP-1" } });
    expect(job!.size).toBeGreaterThan(0);
    expect(await queue.list()).toHaveLength(1);
    expect(meta.data.get("shell:file-blob:job-1")).toBeInstanceOf(Blob);
    expect(log).toEqual([]);
  });

  test("an empty file, a file over the cap and a nameless file are not kept", async () => {
    const { queue } = setup();
    expect(await queue.add(input({ file: new Blob([]) }))).toBeNull();
    expect(await queue.add(input({ file: { size: MAX_FILE_BYTES + 1, type: "application/pdf" } as unknown as Blob }))).toBeNull();
    expect(await queue.add(input({ fileName: "  " }))).toBeNull();
    expect(await queue.list()).toEqual([]);
  });
});

describe("flush: the bytes go up first, then the record is queued, then the job and its bytes are gone", () => {
  test("upload, then record with the file's address, in that order", async () => {
    const { queue, meta, log } = setup();
    await queue.add(input());
    const r = await queue.flush();
    expect(log).toEqual(["upload:fitout.pdf", "record:fitout.pdf:https://storage.example/x.pdf"]);
    expect(r).toMatchObject({ uploaded: 1, queued: 1, dropped: 0, kept: 0, stoppedBecause: "none" });
    expect(await queue.list()).toEqual([]);
    expect(meta.data.get("shell:file-blob:job-1")).toBeUndefined();
  });

  test("OFFLINE (nothing reached the server): the job and its bytes stay, no record is queued, the next job is not tried either", async () => {
    const { queue, meta, log } = setup(async () => { throw new TypeError("Failed to fetch"); });
    await queue.add(input());
    await queue.add(input({ fileName: "second.pdf" }));
    const r = await queue.flush();
    expect(r).toMatchObject({ uploaded: 0, queued: 0, kept: 2, stoppedBecause: "offline" });
    expect(log).toEqual(["upload:fitout.pdf"]);
    expect((meta.data.get(FILE_JOBS_META_KEY) as FileJob[]).map((j) => j.state)).toEqual(["waiting", "waiting"]);
    expect(meta.data.get("shell:file-blob:job-1")).toBeInstanceOf(Blob);
  });

  test("uploaded but the record could not be kept just now: the file is NEVER uploaded twice; the next run only queues the record", async () => {
    let fail = true;
    const { queue, log } = setup(undefined, async () => { if (fail) throw new Error("outbox busy"); });
    await queue.add(input());
    const first = await queue.flush();
    expect(first).toMatchObject({ uploaded: 1, queued: 0, kept: 1 });
    expect((await queue.list())[0]).toMatchObject({ state: "uploaded", externalUrl: "https://storage.example/x.pdf" });
    fail = false;
    const second = await queue.flush();
    expect(second).toMatchObject({ uploaded: 0, queued: 1, kept: 0 });
    expect(log.filter((l) => l.startsWith("upload:"))).toHaveLength(1);
  });

  test("a refusal (413) drops that job with a notice in words and the next job is still sent", async () => {
    let call = 0;
    const { queue, log } = setup(async () => { call += 1; if (call === 1) throw new UploadError(413, "the file is too large"); return { externalUrl: "https://storage.example/ok.pdf" }; });
    await queue.add(input({ fileName: "big.pdf" }));
    await queue.add(input({ fileName: "ok.pdf" }));
    const r = await queue.flush();
    expect(r).toMatchObject({ dropped: 1, uploaded: 1, queued: 1, kept: 0 });
    expect((await queue.notices())[0]!.message).toContain("The server did not accept \"big.pdf\": the file is too large");
    expect(log).toContain("record:ok.pdf:https://storage.example/ok.pdf");
  });

  test("signed out (401) and a struggling server (5xx) keep the job; a build with no upload route (501) keeps everything quietly", async () => {
    for (const [status, why] of [[401, "signed_out"], [503, "server"], [501, "not_configured"]] as const) {
      const { queue } = setup(async () => { throw new UploadError(status, "x"); });
      await queue.add(input());
      const r = await queue.flush();
      expect([r.stoppedBecause, r.kept, r.dropped]).toEqual([why, 1, 0]);
      expect(await queue.notices()).toEqual([]);
    }
    const { queue } = setup(notConfiguredUploader.upload);
    await queue.add(input());
    expect((await queue.flush()).stoppedBecause).toBe("not_configured");
  });

  test("a job whose bytes are gone (the browser cleared its storage) is dropped with a notice that says to add it again", async () => {
    const { queue, meta } = setup();
    await queue.add(input());
    meta.data.delete("shell:file-blob:job-1");
    const r = await queue.flush();
    expect(r.dropped).toBe(1);
    expect((await queue.notices())[0]!.message).toContain("no longer on this laptop");
  });

  test("two flushes at once share one run (a file is never sent twice by a double tap)", async () => {
    const { queue, log } = setup();
    await queue.add(input());
    await Promise.all([queue.flush(), queue.flush()]);
    expect(log.filter((l) => l.startsWith("upload:"))).toHaveLength(1);
  });

  test("a notice can be dismissed", async () => {
    const { queue } = setup(async () => { throw new UploadError(422, "bad file"); });
    await queue.add(input());
    await queue.flush();
    const [n] = await queue.notices();
    await queue.dismissNotice(n!.id);
    expect(await queue.notices()).toEqual([]);
  });
});
