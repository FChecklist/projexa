import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import registry from "../../ai/function-registry.json";
import type { EnqueueInput, Outbox } from "../../outbox";
import { FakeMeta } from "../../release/__fixtures__/fakes";
import { createFileQueue, type FileJob } from "../file-queue";
import { deliveryShellData, seedDelivery } from "./delivery-test-seed";
import { addFileRecordOffline, checkFields, enqueueFileRecord, recordOp } from "./file-writes";

// A permit / drawing / document is a record AND a file: the file is kept, uploaded, and only then is the registry's create_* queued with
// externalUrl. The names sent are the live registry's (the same data the AI link validates against).

type Fn = { function_id: string; kind: string; declared_params: string[]; required_params: { name: string; any_of: string[] }[] };
const FUNCTIONS = (registry as { functions: Fn[] }).functions;
const pdf = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });

const PERMIT = { name: " Fit-out permit ", permitNumber: "FP-1", permitAuthority: "Municipality", expiryDate: "2027-01-31", issueDate: "2026-10-01" };
const DRAWING = { name: "AR-101 Ground floor", drawingNo: "AR-101", rev: "B", discipline: "Architecture", kind: "plan", status: "issued" };
const DOCUMENT = { name: "Site plan", category: "drawing", expiryDate: "2027-03-01" };

describe("what the person typed is checked in plain words", () => {
  test("a permit needs a name, a number, an authority and an expiry date; an issue date after the expiry is refused", () => {
    expect(checkFields("permit", { ...PERMIT, name: " " })).toMatchObject({ ok: false, message: "Give the permit a name (up to 200 letters)." });
    expect(checkFields("permit", { ...PERMIT, permitNumber: "" })).toMatchObject({ ok: false, message: "Give the permit number." });
    expect(checkFields("permit", { ...PERMIT, permitAuthority: "" })).toMatchObject({ ok: false, message: "Say who issued the permit." });
    expect(checkFields("permit", { ...PERMIT, expiryDate: "soon" })).toMatchObject({ ok: false, message: "Choose the date the permit expires." });
    expect(checkFields("permit", { ...PERMIT, issueDate: "2027-02-01" })).toMatchObject({ ok: false });
    expect(checkFields("permit", PERMIT)).toEqual({ ok: true, fields: { name: "Fit-out permit", permitNumber: "FP-1", permitAuthority: "Municipality", expiryDate: "2027-01-31", issueDate: "2026-10-01" } });
  });

  test("a drawing needs only a name; blank details are left out, an over-long one is refused", () => {
    expect(checkFields("drawing", { name: "AR-101", drawingNo: " ", rev: null })).toEqual({ ok: true, fields: { name: "AR-101" } });
    expect(checkFields("drawing", { name: "AR-101", rev: "x".repeat(201) })).toMatchObject({ ok: false, message: "A drawing detail is too long (up to 200 letters)." });
  });

  test("a document needs a name and a category; the expiry date is optional but must be real", () => {
    expect(checkFields("document", { name: "Site plan", category: "" })).toMatchObject({ ok: false });
    expect(checkFields("document", { name: "Site plan", category: "drawing", expiryDate: "31/01/2027" })).toMatchObject({ ok: false });
    expect(checkFields("document", { name: "Site plan", category: "drawing" })).toEqual({ ok: true, fields: { name: "Site plan", category: "drawing" } });
  });
});

describe("a finished upload becomes the registry's create_* op, with the file's address as externalUrl", () => {
  const job = (kind: "permit" | "drawing" | "document", fields: Record<string, unknown>) => ({ kind, projectId: "p1", fields, externalUrl: "https://storage.example/f.pdf" });

  test("the function, the parameters (create_document has NO projectId) and the label", () => {
    expect(recordOp(job("permit", { name: "A" }))).toEqual({ functionId: "create_permit", params: { projectId: "p1", name: "A", externalUrl: "https://storage.example/f.pdf" }, label: "New permit" });
    expect(recordOp(job("drawing", { name: "B" })).functionId).toBe("create_drawing");
    const doc = recordOp(job("document", { name: "C", category: "drawing" }));
    expect(doc.functionId).toBe("create_document");
    expect("projectId" in doc.params).toBe(false);
  });

  test("against the REAL registry: every parameter is declared, every required one is there, all three are writes", () => {
    const filled = [
      recordOp(job("permit", checkFields("permit", PERMIT).ok ? (checkFields("permit", PERMIT) as { fields: Record<string, unknown> }).fields : {})),
      recordOp(job("drawing", (checkFields("drawing", DRAWING) as { fields: Record<string, unknown> }).fields)),
      recordOp(job("document", (checkFields("document", DOCUMENT) as { fields: Record<string, unknown> }).fields)),
    ];
    for (const op of filled) {
      const fn = FUNCTIONS.find((f) => f.function_id === op.functionId)!;
      expect(fn, op.functionId).toBeDefined();
      expect(fn.kind).toBe("write");
      expect({ fn: fn.function_id, undeclared: Object.keys(op.params).filter((k) => !fn.declared_params.includes(k)) }).toEqual({ fn: fn.function_id, undeclared: [] });
      const missing = fn.required_params.filter((r) => !r.any_of.some((n) => op.params[n] !== undefined && op.params[n] !== null && op.params[n] !== "")).map((r) => r.name);
      expect({ fn: fn.function_id, missing }).toEqual({ fn: fn.function_id, missing: [] });
    }
  });
});

describe("addFileRecordOffline keeps the file and the fields; the record waits for the upload", () => {
  async function rig(over: Parameters<typeof deliveryShellData>[1] = {}) {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ projectId: "p1", kind: "documents", rows: [] }]);
    const data = deliveryShellData(idb, over);
    const meta = new FakeMeta();
    const enqueued: EnqueueInput[] = [];
    const outbox = { enqueue: async (i: EnqueueInput) => { enqueued.push(i); return { opId: `op-${enqueued.length}` }; } } as unknown as Outbox;
    let n = 0;
    const queue = createFileQueue({
      meta, now: () => 1_760_000_000_000, newId: () => `job-${++n}`,
      uploader: { upload: async (j) => ({ externalUrl: `https://storage.example/${j.fileName}` }) },
      enqueueRecord: (j: FileJob & { externalUrl: string }) => enqueueFileRecord(data, j, { outbox }),
    });
    return { data, queue, enqueued, meta };
  }

  test("add keeps a job (nothing queued in the outbox yet); a flush uploads, then queues create_permit once", async () => {
    const { data, queue, enqueued } = await rig();
    const r = await addFileRecordOffline(data, "permit", { projectId: "p1", fields: PERMIT, file: pdf(), fileName: "fitout.pdf" }, queue);
    expect(r).toEqual({ ok: true, jobId: "job-1" });
    expect(enqueued).toEqual([]);
    expect((await queue.list())[0]).toMatchObject({ kind: "permit", state: "waiting", fields: { name: "Fit-out permit", permitNumber: "FP-1" } });
    await queue.flush();
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      functionId: "create_permit", projectId: "p1", label: "New permit",
      params: { projectId: "p1", name: "Fit-out permit", permitNumber: "FP-1", permitAuthority: "Municipality", expiryDate: "2027-01-31", issueDate: "2026-10-01", externalUrl: "https://storage.example/fitout.pdf" },
    });
    expect(await queue.list()).toEqual([]);
  });

  test("refused in words, nothing kept: a bad field, no file, a read-only role, a project that is not on this laptop, another organisation", async () => {
    const { data, queue, meta } = await rig();
    const ask = (d: typeof data, fields = PERMIT, file: Blob | null = pdf(), projectId = "p1") => addFileRecordOffline(d, "permit", { projectId, fields, file, fileName: "a.pdf" }, queue);
    expect(await ask(data, { ...PERMIT, permitNumber: "" })).toMatchObject({ ok: false, message: "Give the permit number." });
    expect(await ask(data, PERMIT, null)).toMatchObject({ ok: false, message: "Choose the file for this permit." });
    expect(await ask(data, PERMIT, new Blob([]))).toMatchObject({ ok: false });
    expect(await ask({ ...data, role: "viewer" })).toMatchObject({ ok: false, message: "Your role can read these but not add a permit." });
    expect(await ask(data, PERMIT, pdf(), "p9")).toMatchObject({ ok: false });
    expect(await ask({ ...data, orgId: "orgB" })).toMatchObject({ ok: false });
    expect(await queue.list()).toEqual([]);
    expect([...meta.data.keys()].filter((k) => k.startsWith("shell:file-blob:"))).toEqual([]);
  });

  test("a drawing and a document go through the same two steps", async () => {
    const { data, queue, enqueued } = await rig();
    expect((await addFileRecordOffline(data, "drawing", { projectId: "p1", fields: DRAWING, file: pdf(), fileName: "ar101.pdf" }, queue)).ok).toBe(true);
    expect((await addFileRecordOffline(data, "document", { projectId: "p1", fields: DOCUMENT, file: pdf(), fileName: "plan.pdf" }, queue)).ok).toBe(true);
    await queue.flush();
    expect(enqueued.map((e) => e.functionId)).toEqual(["create_drawing", "create_document"]);
    expect("projectId" in enqueued[1]!.params).toBe(false);
  });
});
