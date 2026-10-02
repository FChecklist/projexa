import { describe, expect, test } from "bun:test";
import {
  JobExecutionError, attachWorkerHandler, createInProcessExecutor, createWorkerExecutor, handleRunRequest, type WorkerLike, type WorkerRequest, type WorkerResponse, type WorkerScopeLike,
} from "./worker";

const rows = [{ id: "1", boqId: "b", amount: "5" }, { id: "2", boqId: "b", amount: "7.5" }];

describe("worker protocol", () => {
  test("run -> ok response carries the result", async () => {
    const res = await handleRunRequest({ kind: "run", id: "x", type: "boq_rollup", rows, params: {} });
    expect(res).toMatchObject({ id: "x", ok: true });
    expect((res as { result: { total: string } }).result.total).toBe("12.50");
  });
  test("an unknown type is answered UNKNOWN_TYPE and never computed", async () => {
    expect(await handleRunRequest({ kind: "run", id: "x", type: "rm_rf", rows, params: {} })).toEqual({ id: "x", ok: false, error: "UNKNOWN_TYPE" });
  });
  test("bad rows are BAD_REQUEST", async () => {
    expect(await handleRunRequest({ kind: "run", id: "x", type: "boq_rollup", rows: "no" as unknown as unknown[], params: {} })).toEqual({ id: "x", ok: false, error: "BAD_REQUEST" });
  });

  test("a real message loop: a scope and an executor talk through the protocol, and cancel is honoured between slices", async () => {
    const scope: WorkerScopeLike & { sent: WorkerResponse[] } = { onmessage: null, sent: [], postMessage(m) { this.sent.push(m); } };
    // the worker side yields to the event loop every slice, so a cancel message can arrive while it runs
    attachWorkerHandler(scope, { budgetMs: 0, checkEvery: 1 });
    const worker: WorkerLike & { posted: WorkerRequest[] } = {
      posted: [], onmessage: null, onerror: null, terminate() {},
      postMessage(msg) {
        this.posted.push(msg);
        queueMicrotask(() => scope.onmessage?.({ data: msg }));
      },
    };
    const origPost = scope.postMessage.bind(scope);
    scope.postMessage = (m) => { origPost(m); worker.onmessage?.({ data: m }); };
    const exec = createWorkerExecutor(worker);
    expect(await exec("boq_rollup", rows, {})).toMatchObject({ total: "12.50" });
    await expect(exec("nope", rows, {})).rejects.toMatchObject({ code: "UNKNOWN_TYPE" });

    const big = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), boqId: "b", amount: "1" }));
    const ctl = new AbortController();
    const p = exec("boq_rollup", big, {}, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    expect(worker.posted.some((m) => m.kind === "cancel")).toBe(true);
  });

  test("a Worker crash rejects what was pending", async () => {
    const worker: WorkerLike = { onmessage: null, onerror: null, terminate() {}, postMessage() { queueMicrotask(() => worker.onerror?.({})); } };
    await expect(createWorkerExecutor(worker)("boq_rollup", rows, {})).rejects.toBeInstanceOf(JobExecutionError);
  });

  test("in-process executor: same answer, coded failure, abort", async () => {
    const exec = createInProcessExecutor();
    expect(await exec("csv_export", [{ id: "1", a: "x" }], { kind: "k" })).toMatchObject({ rowCount: 1 });
    await expect(exec("unknown", [], {})).rejects.toMatchObject({ code: "UNKNOWN_TYPE" });
    const ctl = new AbortController();
    ctl.abort();
    await expect(exec("boq_rollup", rows, {}, ctl.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
