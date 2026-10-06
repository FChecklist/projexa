// LOCAL-FIRST shell: a FILE waiting on the laptop (G-15: a permit, a drawing or a document is a record AND a file).
//
// THE ORDER IS THE POINT. The registry's create_permit / create_drawing / create_document take an `externalUrl`: a record cannot be created
// until its file is somewhere the server can read. So a person's "add this permit" with a PDF is kept as a JOB on the laptop (the file's bytes in
// the person's own database, the typed fields beside them), and a flush does two steps in this order:
//
//   1. UPLOAD the bytes (UploadPort, straight to storage with a short-lived address; no server of ours carries the file) -> job.externalUrl
//   2. QUEUE the record (the job's `enqueueRecord`, i.e. create_permit etc. through the outbox, with externalUrl) -> the job is done
//
// Both steps are kept across a closed tab or a dead battery: a job is `waiting` (bytes here, nothing uploaded) or `uploaded` (bytes are up,
// the record not yet queued; the bytes are then dropped from the laptop). Step 2 only writes to the laptop's own outbox, so it works offline too.
//
// Honest limits of this first release: one request per file (not resumable inside a file: a lost connection restarts THAT file's upload;
// finished files are never sent twice), and a size cap (MAX_FILE_BYTES) because a browser database is not a file server.
//
// Failures follow shell/pending-edits.ts: nothing reached the server, a 5xx, a 429 or a 401 keeps the job and stops the run (tried again when
// the laptop is online); a real refusal (400/403/404/413/415/422) drops the job with a notice in plain words, never a retry loop.

import type { MetaStore } from "../release/installer";

export const FILE_JOBS_META_KEY = "shell:file-jobs";
export const FILE_NOTICES_META_KEY = "shell:file-notices";
const blobKey = (id: string) => `shell:file-blob:${id}`;

/** 25 MB: the largest file this release keeps on a laptop to send later. Bigger files are added while connected. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type FileJobKind = "permit" | "drawing" | "document";

export type FileJob = {
  id: string;
  kind: FileJobKind;
  projectId: string;
  fileName: string;
  contentType: string;
  size: number;
  /** What the person typed for the record (sent with the file's address when the record is queued). */
  fields: Record<string, unknown>;
  state: "waiting" | "uploaded";
  /** Set once the bytes are up. */
  externalUrl?: string;
  at: number;
  attempts: number;
};

export type FileNotice = { id: string; at: number; fileName: string; message: string };

/** The only thing the queue needs from a transport. Rejects with an UploadError; a plain throw is "nothing reached the server". */
export type UploadPort = {
  upload(job: Pick<FileJob, "kind" | "projectId" | "fileName" | "contentType" | "size">, bytes: Blob, signal?: AbortSignal): Promise<{ externalUrl: string }>;
};

/** An answer from the server (or the signing step) that is not success. `status` decides keep-and-retry vs drop. */
export class UploadError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export type FileFlushResult = { uploaded: number; queued: number; dropped: number; kept: number; stoppedBecause: "none" | "offline" | "server" | "signed_out" | "not_configured" };

export type FileQueueDeps = {
  meta: MetaStore;
  uploader: UploadPort;
  /** Step 2: put the record in the outbox (create_permit ...). Resolves when it is kept on the laptop; rejects when it could not be (the job stays). */
  enqueueRecord: (job: FileJob & { externalUrl: string }) => Promise<void>;
  now?: () => number;
  newId?: () => string;
  onChange?: () => void;
};

export type AddFileInput = Omit<FileJob, "id" | "state" | "externalUrl" | "at" | "attempts" | "fileName" | "contentType" | "size"> & { file: Blob; fileName: string };

export type FileQueue = {
  list(): Promise<FileJob[]>;
  /** Keeps the file and the typed fields on the laptop. Returns null (nothing kept) for an empty file or one over MAX_FILE_BYTES. */
  add(input: AddFileInput): Promise<FileJob | null>;
  flush(): Promise<FileFlushResult>;
  notices(): Promise<FileNotice[]>;
  dismissNotice(id: string): Promise<void>;
};

const REFUSALS = new Set([400, 403, 404, 413, 415, 422]);

export function createFileQueue(deps: FileQueueDeps): FileQueue {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${now()}-${Math.random().toString(36).slice(2)}`));
  let running: Promise<FileFlushResult> | null = null;

  // one lane for every read-modify-write of the stored jobs (same reason as pending-edits.ts)
  let lane: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lane.then(fn, fn);
    lane = run.then(() => undefined, () => undefined);
    return run;
  };

  const read = async () => ((await deps.meta.getMeta<FileJob[]>(FILE_JOBS_META_KEY)) ?? []).filter((j) => j && typeof j.id === "string");
  const write = async (jobs: FileJob[]) => {
    await deps.meta.setMeta(FILE_JOBS_META_KEY, jobs);
    deps.onChange?.();
  };
  const readNotices = async () => (await deps.meta.getMeta<FileNotice[]>(FILE_NOTICES_META_KEY)) ?? [];

  const drop = (job: FileJob, message: string) =>
    exclusive(async () => {
      await write((await read()).filter((j) => j.id !== job.id));
      await deps.meta.setMeta(blobKey(job.id), undefined);
      await deps.meta.setMeta(FILE_NOTICES_META_KEY, [...(await readNotices()), { id: newId(), at: now(), fileName: job.fileName, message }].slice(-20));
      deps.onChange?.();
    });

  async function flushOnce(): Promise<FileFlushResult> {
    const result: FileFlushResult = { uploaded: 0, queued: 0, dropped: 0, kept: 0, stoppedBecause: "none" };
    for (let job of await read()) {
      if (job.state === "waiting") {
        const bytes = await deps.meta.getMeta<Blob>(blobKey(job.id));
        if (!bytes) {
          await drop(job, `The file "${job.fileName}" is no longer on this laptop, so it could not be sent. Add it again.`);
          result.dropped += 1;
          continue;
        }
        try {
          const { externalUrl } = await deps.uploader.upload({ kind: job.kind, projectId: job.projectId, fileName: job.fileName, contentType: job.contentType, size: job.size }, bytes);
          job = { ...job, state: "uploaded", externalUrl };
          const uploaded = job;
          await exclusive(async () => write((await read()).map((j) => (j.id === uploaded.id ? uploaded : j))));
          result.uploaded += 1;
        } catch (err) {
          const status = err instanceof UploadError ? err.status : 0;
          if (status === 401) { result.stoppedBecause = "signed_out"; break; }
          if (status === 501) { result.stoppedBecause = "not_configured"; break; } // this build has no upload route yet: keep everything
          if (REFUSALS.has(status)) {
            await drop(job, `The server did not accept "${job.fileName}": ${err instanceof Error && err.message ? err.message : `HTTP ${status}`}`);
            result.dropped += 1;
            continue;
          }
          // nothing reached the server (status 0), a 5xx, a 429, a 408: keep this and everything after it, in order
          if (status !== 0) await exclusive(async () => write((await read()).map((j) => (j.id === job.id ? { ...j, attempts: j.attempts + 1 } : j))));
          result.stoppedBecause = status === 0 ? "offline" : "server";
          break;
        }
      }
      // step 2 (also reached by a job that was uploaded in an earlier run): the record goes into the outbox, then the job and its bytes go
      if (job.state === "uploaded" && job.externalUrl) {
        try {
          await deps.enqueueRecord({ ...job, externalUrl: job.externalUrl });
        } catch {
          continue; // the laptop could not keep the record just now: the job stays (the file is already up) and is tried again next run
        }
        await exclusive(async () => {
          await write((await read()).filter((j) => j.id !== job.id));
          await deps.meta.setMeta(blobKey(job.id), undefined);
        });
        result.queued += 1;
      }
    }
    result.kept = (await read()).length;
    return result;
  }

  return {
    list: read,
    async add(input) {
      const { file, fileName, ...rest } = input;
      if (!file || file.size <= 0 || file.size > MAX_FILE_BYTES || !fileName.trim()) return null;
      const job: FileJob = {
        id: newId(), ...rest, fileName: fileName.trim(), contentType: file.type || "application/octet-stream", size: file.size, state: "waiting", at: now(), attempts: 0,
      };
      return exclusive(async () => {
        await deps.meta.setMeta(blobKey(job.id), file); // the bytes first: a job without bytes would be useless
        await write([...(await read()), job]);
        return job;
      });
    },
    async flush() {
      if (!running) {
        running = flushOnce()
          .catch((): FileFlushResult => ({ uploaded: 0, queued: 0, dropped: 0, kept: 0, stoppedBecause: "offline" }))
          .finally(() => { running = null; });
      }
      return running;
    },
    notices: readNotices,
    dismissNotice(id) {
      return exclusive(async () => {
        await deps.meta.setMeta(FILE_NOTICES_META_KEY, (await readNotices()).filter((n) => n.id !== id));
        deps.onChange?.();
      });
    },
  };
}

/** The upload port of a build that has no upload route yet: every upload says "not configured", so jobs wait (nothing is lost, nothing is sent). */
export const notConfiguredUploader: UploadPort = {
  async upload() {
    throw new UploadError(501, "File upload is not set up in this version yet.");
  },
};
