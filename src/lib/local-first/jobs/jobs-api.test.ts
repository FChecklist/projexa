import { describe, expect, test } from "bun:test";
import { createJobsApi, JobsError } from "./jobs-api";

function api(handler: (url: string, init: RequestInit) => Response | Promise<Response>, token: string | null = "tok") {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { calls, api: createJobsApi({ getAccessToken: async () => token, baseUrl: "https://x.test/sync", fetchImpl, getReleaseVersion: () => "r1" }) };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

describe("jobs api", () => {
  test("enqueue sends the contract body and headers; visibility defaults to requester", async () => {
    const h = api(() => json({ job_id: "j1" }));
    expect(await h.api.enqueue({ projectId: "p", type: "boq_rollup", params: { a: 1 } })).toEqual({ jobId: "j1" });
    expect(h.calls[0].url).toBe("https://x.test/sync/jobs/enqueue");
    expect(h.calls[0].body).toEqual({ project_id: "p", type: "boq_rollup", params: { a: 1 }, visibility: "requester" });
    const headers = h.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Px-Client"]).toContain("r1; protocol=2");
  });
  test("claim / heartbeat / result / get map the response", async () => {
    const job = { job_id: "j", type: "boq_rollup", project_id: "p", params: {}, lease_id: "l", lease_expires_at: "2026-10-02T09:01:00.000Z", attempt: 1, requested_by_you: true };
    expect(await api(() => json({ job, server_time: "t" })).api.claim({ deviceId: "device-0001", types: ["boq_rollup"] })).toEqual({ job, serverTime: "t" });
    expect((await api(() => json({ job: null })).api.claim({ deviceId: "device-0001", types: ["boq_rollup"] })).job).toBeNull();
    expect(await api(() => json({ outcome: "extended", lease_expires_at: "x", server_time: "t" })).api.heartbeat({ jobId: "j", leaseId: "l" })).toEqual({ outcome: "extended", leaseExpiresAt: "x", serverTime: "t" });
    const r = api(() => json({ outcome: "accepted", job_status: "done" }));
    expect(await r.api.result({ jobId: "j", leaseId: "l", ok: true, result: { a: 1 } })).toEqual({ outcome: "accepted", jobStatus: "done" });
    expect(r.calls[0].body).toEqual({ job_id: "j", lease_id: "l", ok: true, result: { a: 1 } });
    const f = api(() => json({ outcome: "accepted", job_status: "failed" }));
    await f.api.result({ jobId: "j", leaseId: "l", ok: false, error: "X" });
    expect(f.calls[0].body).toEqual({ job_id: "j", lease_id: "l", ok: false, error: "X" });
    expect(await api(() => json({ job_status: "done", attempts: 1, type: "boq_rollup", result: { z: 1 }, error_code: null, ran_here: true })).api.get({ jobId: "j" })).toMatchObject({ jobStatus: "done", result: { z: 1 }, ranHere: true });
  });
  test("a malformed claimed job is a bad_response, never run", async () => {
    await expect(api(() => json({ job: { job_id: "j" } })).api.claim({ deviceId: "device-0001", types: ["boq_rollup"] })).rejects.toMatchObject({ kind: "bad_response" });
  });
  test("errors are classified and never retried inside", async () => {
    const cases: Array<[number, string]> = [[401, "signed_out"], [426, "update_required"], [404, "not_found"], [429, "rate_limited"], [400, "bad_request"], [503, "server"], [418, "bad_response"]];
    for (const [status, kind] of cases) {
      const h = api(() => new Response("{}", { status }));
      await expect(h.api.get({ jobId: "j" })).rejects.toMatchObject({ kind });
      expect(h.calls.length).toBe(1);
    }
    await expect(api(() => { throw new Error("offline"); }).api.get({ jobId: "j" })).rejects.toMatchObject({ kind: "network" });
    const noToken = api(() => json({}), null);
    await expect(noToken.api.get({ jobId: "j" })).rejects.toBeInstanceOf(JobsError);
    expect(noToken.calls.length).toBe(0);
  });
});
