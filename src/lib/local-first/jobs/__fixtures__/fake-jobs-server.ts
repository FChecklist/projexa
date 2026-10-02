// A fake of the job queue with the semantics of compliance-tracker drizzle/0682_projexa_work_jobs.sql, so the claim
// loop and the requester are tested against the rules the server really enforces:
//   whitelist of 4 types; params <= 16 KB, result <= 256 KB; caps (30 open, 200/day); requester-only unless visibility
//   'project'; a colleague needs the same organisation, read access to the project AND the same view class; claim =
//   oldest queued job, a LEASE (10..120 s, default 60) and attempts+1 (max 3: the third lapse fails it for good);
//   heartbeat extends 60 s but never past 5 minutes from the lease start; a result after the lease is refused
//   (lease_expired) and the job is offered again; a result twice answers `duplicate`; only the requester reads a job.
// Every call is recorded in `calls` so a test can assert "no request was made".
import { JobsError, type ClaimedJob, type JobStatus, type JobsApi } from "../jobs-api";

export type FakeUser = { id: string; org: string; viewClass: string; projects: string[] };
type Row = {
  id: string; org: string; project: string; type: string; params: unknown; visibility: "requester" | "project"; viewClass: string; requestedBy: string;
  status: JobStatus; attempts: number; leaseId: string | null; claimedBy: string | null; device: string | null; leaseStart: number | null; leaseExpires: number | null;
  result: unknown; errorCode: string | null; createdAt: number;
};
export type FakeCall = { route: "enqueue" | "claim" | "heartbeat" | "result" | "get"; user: string; at: number };

const TYPES = ["boq_rollup", "csv_export", "report_preview", "search_index"];
const iso = (ms: number) => new Date(ms).toISOString();

export function createFakeJobsServer(now: () => number) {
  const users = new Map<string, FakeUser>();
  const jobs: Row[] = [];
  const calls: FakeCall[] = [];
  let n = 0;
  const err = (kind: ConstructorParameters<typeof JobsError>[0], status: number) => new JobsError(kind, kind, status);

  const expireLeases = (org: string) => {
    for (const j of jobs) {
      if (j.org !== org || j.status !== "claimed" || (j.leaseExpires ?? 0) >= now()) continue;
      if (j.attempts < 3) Object.assign(j, { status: "queued", leaseId: null, claimedBy: null, device: null });
      else Object.assign(j, { status: "failed", errorCode: "LEASE_EXPIRED" });
    }
  };

  function apiFor(userId: string): JobsApi {
    const u = users.get(userId);
    if (!u) throw new Error(`unknown fake user ${userId}`);
    const rec = (route: FakeCall["route"]) => calls.push({ route, user: userId, at: now() });
    return {
      async enqueue(req) {
        rec("enqueue");
        if (!TYPES.includes(req.type) || (req.visibility && !["requester", "project"].includes(req.visibility)) || JSON.stringify(req.params ?? null).length > 16384) throw err("bad_request", 400);
        if (!u.projects.includes(req.projectId)) throw err("not_found", 404);
        if (jobs.filter((j) => j.requestedBy === u.id && ["queued", "claimed"].includes(j.status)).length >= 30
          || jobs.filter((j) => j.requestedBy === u.id && j.createdAt > now() - 86_400_000).length >= 200) throw err("rate_limited", 429);
        const row: Row = { id: `job${++n}`, org: u.org, project: req.projectId, type: req.type, params: req.params, visibility: req.visibility ?? "requester", viewClass: u.viewClass, requestedBy: u.id, status: "queued", attempts: 0, leaseId: null, claimedBy: null, device: null, leaseStart: null, leaseExpires: null, result: null, errorCode: null, createdAt: now() };
        jobs.push(row);
        return { jobId: row.id };
      },
      async claim(req) {
        rec("claim");
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.deviceId) || req.types.length < 1 || req.types.length > 8) throw err("bad_request", 400);
        expireLeases(u.org);
        const secs = Math.min(Math.max(req.leaseSeconds ?? 60, 10), 120);
        const j = jobs.filter((x) => x.org === u.org && x.status === "queued" && req.types.includes(x.type)
          && (x.requestedBy === u.id || (x.visibility === "project" && x.viewClass === u.viewClass && u.projects.includes(x.project))))
          .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0];
        if (!j) return { job: null, serverTime: iso(now()) };
        Object.assign(j, { status: "claimed", attempts: j.attempts + 1, leaseId: `lease${++n}`, claimedBy: u.id, device: req.deviceId, leaseStart: now(), leaseExpires: now() + secs * 1000 });
        const job: ClaimedJob = { job_id: j.id, type: j.type, project_id: j.project, params: j.params, lease_id: j.leaseId!, lease_expires_at: iso(j.leaseExpires!), attempt: j.attempts, requested_by_you: j.requestedBy === u.id };
        return { job, serverTime: iso(now()) };
      },
      async heartbeat(req) {
        rec("heartbeat");
        const j = jobs.find((x) => x.id === req.jobId && x.org === u.org && x.claimedBy === u.id && x.leaseId === req.leaseId && x.status === "claimed");
        if (!j || (j.leaseExpires ?? 0) < now()) return { outcome: "lease_expired", leaseExpiresAt: null, serverTime: iso(now()) };
        j.leaseExpires = Math.min(now() + 60_000, (j.leaseStart ?? 0) + 5 * 60_000);
        return { outcome: "extended", leaseExpiresAt: iso(j.leaseExpires), serverTime: iso(now()) };
      },
      async result(req) {
        rec("result");
        if ((req.ok && (req.result === undefined || req.result === null || JSON.stringify(req.result).length > 262_144)) || (req.error && req.error.length > 64)) throw err("bad_request", 400);
        const j = jobs.find((x) => x.id === req.jobId && x.org === u.org);
        if (!j || j.claimedBy !== u.id || j.leaseId !== req.leaseId) throw err("not_found", 404);
        if (j.status === "done" || j.status === "failed") return { outcome: "duplicate", jobStatus: j.status };
        if (j.status !== "claimed" || (j.leaseExpires ?? 0) < now()) return { outcome: "lease_expired", jobStatus: null };
        Object.assign(j, { status: req.ok ? "done" : "failed", result: req.ok ? req.result : null, errorCode: req.ok ? null : (req.error ?? "FAILED"), });
        return { outcome: "accepted", jobStatus: j.status };
      },
      async get(req) {
        rec("get");
        const j = jobs.find((x) => x.id === req.jobId && x.org === u.org && x.requestedBy === u.id);
        if (!j) throw err("not_found", 404);
        return { jobStatus: j.status, attempts: j.attempts, type: j.type, result: j.result, errorCode: j.errorCode, ranHere: j.claimedBy === u.id };
      },
    };
  }

  return {
    addUser(u: FakeUser) { users.set(u.id, u); },
    apiFor,
    jobs,
    calls,
    callsBy: (route: FakeCall["route"]) => calls.filter((c) => c.route === route),
  };
}
export type FakeJobsServer = ReturnType<typeof createFakeJobsServer>;
