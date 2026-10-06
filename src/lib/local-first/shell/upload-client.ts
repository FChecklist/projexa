// LOCAL-FIRST shell: the UploadPort (file-queue.ts) over the projexa-api "signed upload" contract (G-15; written against the PM's contract
// of 2026-10-06, the endpoint itself is built by another session). No Vercel and no server of ours carries the file's bytes:
//
//   1. POST <projexa-api>/uploads/sign   Authorization: Bearer <the person's PROJEXA session token>
//        {kind, projectId?, fileName, contentType, size}
//        -> 200 {uploadUrl, method: "PUT", headers: {...}, externalUrl, expiresAt, maxBytes}
//        refusals: 401 signed out, 413 too big (50 MB), 415 type not allowed, 422 bad body, 429 too many uploads this hour, 5xx retry
//   2. PUT <uploadUrl> with EXACTLY the returned headers, no Authorization (the address carries its own token), body = the file
//   3. the record is created with externalUrl unchanged (the public, permanent address of the stored file)
//
// A stale address is never reused: every attempt asks for a fresh one (the queue calls upload() once per attempt), and a PUT the storage
// answers 401/403 (an address that expired between the two calls) asks for a new one once.
//
// What the caller (file-queue.ts) is told: UploadError(status) for what the server SAID (401 keeps the job, 413/415/422 drop it, 429 and 5xx
// keep it), a plain thrown error when nothing reached the server (offline: keep the job, stop the run).

import { PX_API_EDGE_URL } from "@/lib/px-api";
import { UploadError, type FileJob, type UploadPort } from "./file-queue";

type SignAnswer = { uploadUrl: string; method: string; headers: Record<string, string>; externalUrl: string; expiresAt?: string; maxBytes?: number };

export type SignedUploaderDeps = {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
  /** The projexa-api base (default: the Edge function). */
  base?: string;
  now?: () => number;
};

async function browserAccessToken(): Promise<string | null> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** What the server said, in its own words when it gave some. */
async function words(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown; message?: unknown };
    const t = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
    if (t.trim()) return t.trim();
  } catch {
    /* no JSON body */
  }
  return `HTTP ${res.status}`;
}

const isHttps = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

export function createSignedUploader(deps: SignedUploaderDeps = {}): UploadPort {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = (deps.base ?? PX_API_EDGE_URL).replace(/\/+$/, "");
  const getToken = deps.getAccessToken ?? browserAccessToken;
  const now = deps.now ?? (() => Date.now());

  async function sign(job: Pick<FileJob, "kind" | "projectId" | "fileName" | "contentType" | "size">): Promise<SignAnswer> {
    const token = await getToken();
    if (!token) throw new UploadError(401, "You are signed out.");
    const res = await doFetch(`${base}/uploads/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      credentials: "omit",
      body: JSON.stringify({
        kind: job.kind, fileName: job.fileName, contentType: job.contentType, size: job.size,
        // a document is organisation-wide: it belongs to no one project
        ...(job.kind === "document" ? {} : { projectId: job.projectId }),
      }),
    });
    // A route that is not there (404/405: the upload service is not deployed yet, or this laptop is ahead of it) is "not available", never a refusal
    // of THIS file: the queue keeps everything and waits (501), it must not drop a person's file because of a missing route.
    if (res.status === 404 || res.status === 405) throw new UploadError(501, "File upload is not available yet.");
    if (!res.ok) throw new UploadError(res.status, await words(res));
    let a: Partial<SignAnswer>;
    try {
      a = (await res.json()) as Partial<SignAnswer>;
    } catch {
      throw new UploadError(502, "The upload service answered something this version does not understand.");
    }
    if (!isHttps(a.uploadUrl) || !isHttps(a.externalUrl) || (a.method ?? "PUT").toUpperCase() !== "PUT" || typeof a.headers !== "object" || a.headers === null) {
      throw new UploadError(502, "The upload service answered something this version does not understand.");
    }
    if (typeof a.maxBytes === "number" && job.size > a.maxBytes) throw new UploadError(413, "The file is larger than the server accepts.");
    return { uploadUrl: a.uploadUrl, method: "PUT", headers: a.headers as Record<string, string>, externalUrl: a.externalUrl, expiresAt: a.expiresAt, maxBytes: a.maxBytes };
  }

  async function put(a: SignAnswer, bytes: Blob, signal?: AbortSignal): Promise<Response> {
    // an address that is already past its time is not tried: the caller signs again
    if (a.expiresAt && Date.parse(a.expiresAt) <= now()) return new Response(null, { status: 401 });
    return doFetch(a.uploadUrl, { method: "PUT", headers: a.headers, body: bytes, credentials: "omit", signal });
  }

  return {
    async upload(job, bytes, signal) {
      let signed = await sign(job);
      let res = await put(signed, bytes, signal);
      if (res.status === 401 || res.status === 403) {
        signed = await sign(job); // the address expired between the two calls: one fresh address, once
        res = await put(signed, bytes, signal);
      }
      if (!res.ok) {
        // storage refusing (e.g. 409 the object exists: x-upsert is false) or struggling: say what happened, let the status decide keep or drop
        // Only what is about THIS file is a refusal (413 too big, 415 type, 422 bad). Anything else from storage (a missing bucket, 400, 404,
        // 409, 5xx) is the service's problem, so the file is kept and tried again: 503.
        const refusal = res.status === 413 || res.status === 415 || res.status === 422;
        throw new UploadError(refusal ? res.status : res.status === 429 ? 429 : 503, await words(res));
      }
      return { externalUrl: signed.externalUrl };
    },
  };
}
