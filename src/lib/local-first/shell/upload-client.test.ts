import { describe, expect, test } from "bun:test";
import { FakeMeta } from "../release/__fixtures__/fakes";
import { UploadError, createFileQueue } from "./file-queue";
import { createSignedUploader } from "./upload-client";

// The signed-upload contract of 2026-10-06, as a stub: POST <base>/uploads/sign (bearer token) -> {uploadUrl, method, headers, externalUrl,
// expiresAt, maxBytes}; then PUT uploadUrl with exactly those headers and NO Authorization. The real endpoint is another session's; this
// proves this side keeps to the contract.

const BASE = "https://api.example/functions/v1/projexa-api";
const JOB = { kind: "permit" as const, projectId: "11111111-1111-4111-8111-111111111111", fileName: "fitout.pdf", contentType: "application/pdf", size: 8 };
const bytes = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answer = (over: Record<string, unknown> = {}) => ({
  uploadUrl: "https://storage.example/upload/sign/abc?token=t1", method: "PUT", headers: { "content-type": "application/pdf", "x-upsert": "false" },
  externalUrl: "https://storage.example/public/projexa-files/org/permit/uuid/fitout.pdf", expiresAt: "2099-01-01T00:00:00Z", maxBytes: 50 * 1024 * 1024, ...over,
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function rig(handler: (call: Call, n: number) => Response | Promise<Response>, token: string | null = "tok-1", now = () => Date.parse("2026-10-06T08:00:00Z")) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const call: Call = { url: String(url), method: init?.method ?? "GET", headers, body: init?.body };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { calls, uploader: createSignedUploader({ fetchImpl, getAccessToken: async () => token, base: BASE, now }) };
}

describe("the happy path keeps to the contract", () => {
  test("sign with the person's token and the file facts, then PUT exactly the returned headers with no Authorization; externalUrl comes back unchanged", async () => {
    const { uploader, calls } = rig((c) => (c.url.endsWith("/uploads/sign") ? json(200, answer()) : new Response(null, { status: 200 })));
    const out = await uploader.upload(JOB, bytes());
    expect(out).toEqual({ externalUrl: "https://storage.example/public/projexa-files/org/permit/uuid/fitout.pdf" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: `${BASE}/uploads/sign`, method: "POST" });
    expect(calls[0]!.headers.authorization).toBe("Bearer tok-1");
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ kind: "permit", fileName: "fitout.pdf", contentType: "application/pdf", size: 8, projectId: JOB.projectId });
    expect(calls[1]).toMatchObject({ url: "https://storage.example/upload/sign/abc?token=t1", method: "PUT" });
    expect(calls[1]!.headers["content-type"]).toBe("application/pdf");
    expect(calls[1]!.headers["x-upsert"]).toBe("false");
    expect("authorization" in calls[1]!.headers).toBe(false);
    expect(calls[1]!.body).toBeInstanceOf(Blob);
  });

  test("a document is organisation-wide: no projectId is sent to sign", async () => {
    const { uploader, calls } = rig((c) => (c.url.endsWith("/uploads/sign") ? json(200, answer()) : new Response(null, { status: 200 })));
    await uploader.upload({ ...JOB, kind: "document" }, bytes());
    expect("projectId" in JSON.parse(String(calls[0]!.body))).toBe(false);
  });
});

describe("what the server says decides what the queue does", () => {
  test("each refusal of the signing step carries its status and the server's own words", async () => {
    for (const [status, text] of [[401, "signed out"], [413, "over 50 MB"], [415, "type not allowed"], [422, "bad body"], [429, "too many uploads this hour"], [503, "try later"]] as const) {
      const { uploader, calls } = rig(() => json(status, { error: text }));
      const err = await uploader.upload(JOB, bytes()).catch((e) => e);
      expect(err).toBeInstanceOf(UploadError);
      expect([err.status, err.message]).toEqual([status, text]);
      expect(calls).toHaveLength(1); // nothing was PUT
    }
  });

  test("a route that is not there (404/405, service not deployed yet) is 501 'not available': the file is kept, never dropped", async () => {
    for (const status of [404, 405]) {
      const { uploader } = rig(() => json(status, { error: "Not found" }));
      expect(((await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError).status).toBe(501);
    }
    const { uploader } = rig(() => json(404, {}));
    const queue = createFileQueue({ meta: new FakeMeta(), uploader, enqueueRecord: async () => {}, newId: () => "j", now: () => 1 });
    await queue.add({ kind: "permit", projectId: JOB.projectId, fields: { name: "A" }, file: bytes(), fileName: "a.pdf" });
    expect(await queue.flush()).toMatchObject({ stoppedBecause: "not_configured", dropped: 0, kept: 1 });
    expect(await queue.notices()).toEqual([]);
  });

  test("storage answers about THIS file only with 413/415/422 (a drop); a missing bucket, 400, 404 or 409 from storage keeps the file (503)", async () => {
    for (const [status, expected] of [[413, 413], [415, 415], [422, 422], [400, 503], [404, 503], [409, 503], [500, 503]] as const) {
      const { uploader } = rig((c) => (c.url.endsWith("/uploads/sign") ? json(200, answer()) : new Response("x", { status })));
      expect(((await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError).status).toBe(expected);
    }
  });

  test("403 at the signing step (a read-only role) says so in plain words; the queue drops the job with that notice", async () => {
    const { uploader } = rig(() => json(403, { error: "forbidden" }));
    const err = (await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError;
    expect([err.status, err.message]).toEqual([403, "Your role is not allowed to add files."]);
    const queue = createFileQueue({ meta: new FakeMeta(), uploader, enqueueRecord: async () => {}, newId: () => "j", now: () => 1 });
    await queue.add({ kind: "permit", projectId: JOB.projectId, fields: { name: "A" }, file: bytes(), fileName: "a.pdf" });
    expect(await queue.flush()).toMatchObject({ dropped: 1, kept: 0 });
    expect((await queue.notices())[0]!.message).toContain("Your role is not allowed to add files.");
  });

  test("no session token: 401 without asking the server anything", async () => {
    const { uploader, calls } = rig(() => json(200, answer()), null);
    const err = await uploader.upload(JOB, bytes()).catch((e) => e);
    expect([err.status, calls.length]).toEqual([401, 0]);
  });

  test("nothing reached the server (offline): a plain error, not an UploadError", async () => {
    const { uploader } = rig(() => { throw new TypeError("Failed to fetch"); });
    const err = await uploader.upload(JOB, bytes()).catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(UploadError);
  });

  test("an answer this version does not understand (http address, missing fields, not JSON): 502, nothing PUT", async () => {
    for (const bad of [answer({ uploadUrl: "http://insecure.example/x" }), answer({ externalUrl: "" }), answer({ headers: null }), answer({ method: "POST" })]) {
      const { uploader, calls } = rig(() => json(200, bad));
      expect(((await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError).status).toBe(502);
      expect(calls).toHaveLength(1);
    }
    const { uploader } = rig(() => new Response("<html>", { status: 200 }));
    expect(((await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError).status).toBe(502);
  });

  test("a file larger than the server's maxBytes is refused 413 before anything is PUT", async () => {
    const { uploader, calls } = rig(() => json(200, answer({ maxBytes: 4 })));
    expect(((await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError).status).toBe(413);
    expect(calls).toHaveLength(1);
  });
});

describe("a stale address is never reused", () => {
  test("an address already past its time is not PUT: a fresh one is asked for, once", async () => {
    let signs = 0;
    const { uploader, calls } = rig((c) => {
      if (c.url.endsWith("/uploads/sign")) { signs += 1; return json(200, answer({ expiresAt: signs === 1 ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z" })); }
      return new Response(null, { status: 200 });
    });
    await uploader.upload(JOB, bytes());
    expect(signs).toBe(2);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  test("storage answers 403 (expired between the calls): ONE new address, then it works", async () => {
    let puts = 0;
    const { uploader } = rig((c) => (c.url.endsWith("/uploads/sign") ? json(200, answer()) : new Response(null, { status: ++puts === 1 ? 403 : 200 })));
    expect(await uploader.upload(JOB, bytes())).toMatchObject({ externalUrl: expect.stringContaining("fitout.pdf") });
    expect(puts).toBe(2);
  });

  test("403 twice is not a loop: it is a retryable 503 (the job is kept)", async () => {
    const { uploader, calls } = rig((c) => (c.url.endsWith("/uploads/sign") ? json(200, answer()) : new Response(null, { status: 403 })));
    expect(((await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError).status).toBe(503);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  test("storage struggling (500) is a retryable 503", async () => {
    const { uploader } = rig((c) => (c.url.endsWith("/uploads/sign") ? json(200, answer()) : new Response("boom", { status: 500 })));
    expect(((await uploader.upload(JOB, bytes()).catch((e) => e)) as UploadError).status).toBe(503);
  });
});

describe("with the file queue", () => {
  test("429 keeps the job for later; a good run then uploads once and queues the record", async () => {
    let limited = true;
    const { uploader } = rig((c) => (c.url.endsWith("/uploads/sign") ? (limited ? json(429, { error: "too many uploads this hour" }) : json(200, answer())) : new Response(null, { status: 200 })));
    const queued: string[] = [];
    const queue = createFileQueue({ meta: new FakeMeta(), uploader, enqueueRecord: async (j) => { queued.push(j.externalUrl); }, newId: () => "job-1", now: () => 1 });
    await queue.add({ kind: "permit", projectId: JOB.projectId, fields: { name: "A" }, file: bytes(), fileName: "fitout.pdf" });
    expect((await queue.flush()).stoppedBecause).toBe("server");
    expect(await queue.list()).toHaveLength(1);
    limited = false;
    expect(await queue.flush()).toMatchObject({ uploaded: 1, queued: 1, kept: 0 });
    expect(queued).toEqual(["https://storage.example/public/projexa-files/org/permit/uuid/fitout.pdf"]);
  });
});
