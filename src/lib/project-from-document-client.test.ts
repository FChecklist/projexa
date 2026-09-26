/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. The browser client of "make a project from a file": what it sends, what it reads back, how it waits for a job.
// The server is a fake `fetch`; the file is a real File and the hash is the real SHA-256.
import { describe, expect, test } from "bun:test";
import {
  checkDocumentFile,
  createFromDocumentClient,
  DOCUMENT_MAX_BYTES,
  DocumentError,
  parseJob,
  sha256Hex,
  waitForJob,
  type DocJob,
  type FromDocumentClient,
} from "./project-from-document-client";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const JOB = {
  jobId: "job-1",
  state: "needs_answers",
  fileName: "boq.xlsx",
  projectId: null,
  questions: [{ kind: "no_rate", sheet: "Table 4", row: 7, text: "Row 7 has a quantity and no rate." }],
  reconciliation: { status: "shortfall", expected: 1596280, actual: 1388480, difference: 207800, tolerance: 1, source: "reader", byArea: [{ area: "Play Area", expected: 1343445, actual: 1135645, difference: 207800, status: "shortfall" }] },
  stats: { sheets: 22, rows: 343, lines: 53 },
  error: null,
  updatedAt: "2026-09-27T10:00:00.000Z",
};

function file(text = "PK workbook bytes", name = "boq.xlsx") {
  return new File([text], name);
}

type Call = { url: string; init?: RequestInit };
function fakeFetch(answers: Array<() => Response | Promise<Response>>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return next();
  }) as typeof fetch;
  return { fetch: fake, calls };
}

describe("sha256Hex", () => {
  test("is the real SHA-256 of the bytes, lower-case hex", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("the client's fingerprint is the hash of the file's own bytes", async () => {
    const client = createFromDocumentClient({ fetch: fakeFetch([() => json(200, {})]).fetch });
    expect(await client.fingerprint(new File(["abc"], "a.xlsx"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("checkDocumentFile", () => {
  test("accepts a workbook, a PDF and a Word file inside the size", () => {
    for (const name of ["a.xlsx", "b.PDF", "c.docx"]) expect(checkDocumentFile({ name, size: 1000 })).toBeNull();
  });

  test("refuses another type, an empty file and an oversize file, in words, before any byte moves", () => {
    expect(checkDocumentFile({ name: "a.png", size: 1000 })).toMatch(/Wrong type: \.png/);
    expect(checkDocumentFile({ name: "a.xlsx", size: 0 })).toBe("This file is empty");
    expect(checkDocumentFile({ name: "a.xlsx", size: DOCUMENT_MAX_BYTES + 1 })).toMatch(/^Too large: /);
  });
});

describe("submit", () => {
  test("posts the file and the fields to the proxy: mode, product, name, and the two acknowledgements only when given", async () => {
    const { fetch, calls } = fakeFetch([() => json(202, { state: "received", jobId: "job-1" })]);
    const client = createFromDocumentClient({ fetch });
    const result = await client.submit({ file: file(), productId: "prod-1", name: " Zoomies ", mode: "create", acknowledgeQuestions: true, acknowledgeShortfall: false });
    expect(result).toEqual({ kind: "queued", state: "received", jobId: "job-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/projects/from-document");
    expect(calls[0].init?.method).toBe("POST");
    const form = calls[0].init?.body as FormData;
    expect((form.get("file") as File).name).toBe("boq.xlsx");
    expect(form.get("productId")).toBe("prod-1");
    expect(form.get("name")).toBe("Zoomies");
    expect(form.get("mode")).toBe("create");
    expect(form.get("acknowledgeQuestions")).toBe("true");
    expect(form.has("acknowledgeShortfall")).toBe(false);
  });

  test("leaves the name out when it is blank", async () => {
    const { fetch, calls } = fakeFetch([() => json(202, { state: "received", jobId: "j" })]);
    await createFromDocumentClient({ fetch }).submit({ file: file(), productId: "p", name: "  ", mode: "prepare" });
    expect((calls[0].init?.body as FormData).has("name")).toBe(false);
  });

  test("a duplicate answer is the project the same file already made", async () => {
    const client = createFromDocumentClient({ fetch: fakeFetch([() => json(200, { duplicate: true, projectId: "proj-9" })]).fetch });
    expect(await client.submit({ file: file(), productId: "p", mode: "prepare" })).toEqual({ kind: "duplicate", projectId: "proj-9" });
  });

  test("a refusal keeps the server's sentence, its own code and its issue list", async () => {
    const client = createFromDocumentClient({
      fetch: fakeFetch([() => json(422, { error: "The lines add up to less than the file prints, so nothing was created.", code: null, upstreamCode: "extraction_total_mismatch", issues: ["difference 207800", 5] })]).fetch,
    });
    const error = await client.submit({ file: file(), productId: "p", mode: "prepare" }).catch((e) => e);
    expect(error).toBeInstanceOf(DocumentError);
    expect(error.message).toBe("The lines add up to less than the file prints, so nothing was created.");
    expect(error.status).toBe(422);
    expect(error.code).toBe("extraction_total_mismatch");
    expect(error.issues).toEqual(["difference 207800"]);
  });

  test("an answer with no sentence still says nothing was changed", async () => {
    const client = createFromDocumentClient({ fetch: fakeFetch([() => new Response("<html>bad gateway</html>", { status: 502 })]).fetch });
    const error = await client.submit({ file: file(), productId: "p", mode: "prepare" }).catch((e) => e);
    expect(error.message).toBe("The request failed (HTTP 502). Nothing was changed.");
  });

  test("a dropped connection is a DocumentError with status 0 and no file text in it", async () => {
    const client = createFromDocumentClient({ fetch: (async () => { throw new TypeError("Failed to fetch") }) as unknown as typeof fetch });
    const error = await client.submit({ file: file("SECRET-CELL-TEXT"), productId: "p", mode: "prepare" }).catch((e) => e);
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK");
    expect(String(error.message)).not.toContain("SECRET-CELL-TEXT");
  });

  test("a success answer that is not a job is refused as unreadable", async () => {
    const client = createFromDocumentClient({ fetch: fakeFetch([() => json(202, { hello: "world" })]).fetch });
    const error = await client.submit({ file: file(), productId: "p", mode: "prepare" }).catch((e) => e);
    expect(error.code).toBe("BAD_ANSWER");
  });
});

describe("job", () => {
  test("reads by the hash, or by the job id, and parses the job", async () => {
    const { fetch, calls } = fakeFetch([() => json(200, JOB)]);
    const client = createFromDocumentClient({ fetch });
    const job = await client.job({ sha256: "a".repeat(64) });
    await client.job({ jobId: "job 1" });
    expect(calls[0].url).toBe(`/api/projects/from-document?sha256=${"a".repeat(64)}`);
    expect(calls[1].url).toBe("/api/projects/from-document?jobId=job%201");
    expect(job.state).toBe("needs_answers");
    expect(job.questions).toEqual([{ kind: "no_rate", sheet: "Table 4", row: 7, text: "Row 7 has a quantity and no rate." }]);
    expect(job.reconciliation?.byArea[0]).toEqual({ area: "Play Area", expected: 1343445, actual: 1135645, difference: 207800, status: "shortfall" });
    expect(job.reconciliation?.source).toBe("reader");
    expect(job.stats).toEqual({ sheets: 22, rows: 343, lines: 53 });
  });

  test("a refused job carries its code, sentence and issues", () => {
    const job = parseJob({ ...JOB, state: "rejected", error: { code: "extraction_not_grounded", message: "The extraction cites a row the file does not have.", issues: ["sheet Table 9 row 2"] } });
    expect(job.error).toEqual({ code: "extraction_not_grounded", message: "The extraction cites a row the file does not have.", issues: ["sheet Table 9 row 2"] });
  });

  test("an unknown state or a missing id is not a job", () => {
    expect(() => parseJob({ ...JOB, state: "flying" })).toThrow(DocumentError);
    expect(() => parseJob({ state: "ready" })).toThrow(DocumentError);
    expect(() => parseJob(null)).toThrow(DocumentError);
  });

  test("a 404 keeps the server's sentence and code", async () => {
    const client = createFromDocumentClient({ fetch: fakeFetch([() => json(404, { error: "No such extraction job", upstreamCode: "job_not_found" })]).fetch });
    const error = await client.job({ sha256: "b".repeat(64) }).catch((e) => e);
    expect(error.status).toBe(404);
    expect(error.code).toBe("job_not_found");
  });
});

function fakeClient(states: Array<DocJob | Error>): FromDocumentClient & { reads: number } {
  const client = {
    reads: 0,
    fingerprint: async () => "f".repeat(64),
    submit: async () => ({ kind: "queued", state: "received", jobId: "j" }) as const,
    job: async () => {
      const next = states[Math.min(client.reads, states.length - 1)];
      client.reads += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return client;
}
const at = (state: DocJob["state"], updatedAt = "t1"): DocJob => ({ ...parseJob({ ...JOB, state }), updatedAt });
const noSleep = async () => {};

describe("waitForJob", () => {
  test("waits through received and reading and returns the first settled state", async () => {
    const seen: string[] = [];
    const client = fakeClient([at("received"), at("reading"), at("needs_answers")]);
    const job = await waitForJob(client, "f".repeat(64), { sleep: noSleep, onState: (j) => seen.push(j.state) });
    expect(job.state).toBe("needs_answers");
    expect(seen).toEqual(["received", "reading", "needs_answers"]);
    expect(client.reads).toBe(3);
  });

  test("returns a stopped job at once", async () => {
    const client = fakeClient([at("created")]);
    expect((await waitForJob(client, "f".repeat(64), { sleep: noSleep })).state).toBe("created");
    expect(client.reads).toBe(1);
  });

  test("reads past the old parked answer (same updatedAt) until the server has moved the job", async () => {
    const client = fakeClient([at("needs_answers", "old"), at("needs_answers", "old"), at("reading", "new"), at("created", "newer")]);
    const job = await waitForJob(client, "f".repeat(64), { sleep: noSleep, staleUpdatedAt: "old" });
    expect(job.state).toBe("created");
    expect(client.reads).toBe(4);
  });

  test("a few dropped reads in a row are read past; a fourth gives up with the error", async () => {
    const drop = new DocumentError("The server could not be reached.", 0, "NETWORK");
    const ok = fakeClient([drop, drop, at("ready")]);
    expect((await waitForJob(ok, "f".repeat(64), { sleep: noSleep })).state).toBe("ready");
    const bad = fakeClient([drop]);
    const error = await waitForJob(bad, "f".repeat(64), { sleep: noSleep }).catch((e) => e);
    expect(error).toBe(drop);
    expect(bad.reads).toBe(4);
  });

  test("a real refusal (404) is not retried", async () => {
    const gone = new DocumentError("No such extraction job", 404, "job_not_found");
    const client = fakeClient([gone]);
    await expect(waitForJob(client, "f".repeat(64), { sleep: noSleep })).rejects.toBe(gone);
    expect(client.reads).toBe(1);
  });

  test("gives up with poll_timeout when the job never moves", async () => {
    let clock = 0;
    const client = fakeClient([at("reading")]);
    const error = await waitForJob(client, "f".repeat(64), { sleep: async () => { clock += 60_000 }, now: () => clock, timeoutMs: 120_000 }).catch((e) => e);
    expect(error).toBeInstanceOf(DocumentError);
    expect(error.code).toBe("poll_timeout");
  });

  test("stops with aborted when the signal fires", async () => {
    const controller = new AbortController();
    const client = fakeClient([at("reading")]);
    const error = await waitForJob(client, "f".repeat(64), {
      signal: controller.signal,
      sleep: async () => { controller.abort() },
    }).catch((e) => e);
    expect(error.code).toBe("aborted");
  });
});
