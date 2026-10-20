// LOCAL-FIRST shell: a PHOTO for a progress entry saved on the laptop (R-48: the online Daily Entry form has a Site photo field).
//
// The outbox carries a function call (record_work_progress), never a file, and the photo's route (/api/work-progress/photos) needs the
// SERVER's id of the entry. So a photo is kept as a follow-up job tied to the entry's outbox op:
//
//   add({opId, ...})        the bytes and the op id are kept on the laptop at once          state "waiting_entry"  ("photo waiting to upload")
//   entryApplied(opId, id)  the outbox said the entry reached the server -> now it has an id  state "ready"
//   flush()                 a ready job is POSTed to /api/work-progress/photos; done -> job and bytes gone
//   entryRejected(opId)     the server turned the entry down -> the photo has nothing to attach to: a visible notice, never a silent drop
//
// A photo is never dropped without a notice. Network failure / 5xx / 429 / 401 keep the job (tried again when online); a real refusal
// (400/403/404/413/415/422) drops it WITH a notice in plain words. Same failure policy as file-queue.ts.

import type { MetaStore } from "../release/installer";

export const PHOTO_JOBS_META_KEY = "shell:progress-photo-jobs";
// entries the outbox applied BEFORE their photo was kept (a fast online send): opId -> server id, so add() can start the job as ready
export const PHOTO_APPLIED_META_KEY = "shell:progress-photo-applied";
export const PHOTO_NOTICES_META_KEY = "shell:progress-photo-notices";
const blobKey = (id: string) => `shell:progress-photo-blob:${id}`;

/** The same cap as every other file this laptop keeps to send later (file-queue.ts MAX_FILE_BYTES). */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export type PhotoJob = {
  id: string;
  /** The outbox op of the progress entry this photo belongs to. */
  opId: string;
  projectId: string;
  fileName: string;
  contentType: string;
  size: number;
  state: "waiting_entry" | "ready";
  /** The server's id of the entry, once the outbox applied it. */
  entryId?: string;
  at: number;
  attempts: number;
};

export type PhotoNotice = { id: string; at: number; fileName: string; message: string };

export class PhotoUploadError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

/** Sends one photo for one server entry. Rejects with PhotoUploadError(status); a plain throw is "nothing reached the server". */
export type PhotoUploader = (entryId: string, bytes: Blob, fileName: string) => Promise<void>;

/** The real uploader: the SAME /api/work-progress/photos route the online form uses. */
export const routePhotoUploader: PhotoUploader = async (entryId, bytes, fileName) => {
  const form = new FormData();
  form.append("veridianEntryId", entryId);
  form.append("file", bytes, fileName);
  const res = await fetch("/api/work-progress/photos", { method: "POST", body: form });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error.trim();
    } catch {
      /* no JSON body */
    }
    throw new PhotoUploadError(res.status, message);
  }
};

export type PhotoFlushResult = { sent: number; dropped: number; kept: number; stoppedBecause: "none" | "offline" | "server" | "signed_out" };

export type PhotoQueue = {
  list(): Promise<PhotoJob[]>;
  /** Keeps the photo on the laptop. Returns null (nothing kept) for an empty photo, one over the cap, or one without a name. */
  add(input: { opId: string; projectId: string; file: Blob; fileName: string }): Promise<PhotoJob | null>;
  entryApplied(opId: string, entryId: string): Promise<void>;
  entryRejected(opId: string): Promise<void>;
  flush(): Promise<PhotoFlushResult>;
  notices(): Promise<PhotoNotice[]>;
  dismissNotice(id: string): Promise<void>;
};

export type PhotoQueueDeps = {
  meta: MetaStore;
  upload?: PhotoUploader;
  now?: () => number;
  newId?: () => string;
  onChange?: () => void;
};

const REFUSALS = new Set([400, 403, 404, 413, 415, 422]);

export function createPhotoQueue(deps: PhotoQueueDeps): PhotoQueue {
  const upload = deps.upload ?? routePhotoUploader;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${now()}-${Math.random().toString(36).slice(2)}`));
  let running: Promise<PhotoFlushResult> | null = null;
  let lane: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lane.then(fn, fn);
    lane = run.then(() => undefined, () => undefined);
    return run;
  };
  const read = async () => ((await deps.meta.getMeta<PhotoJob[]>(PHOTO_JOBS_META_KEY)) ?? []).filter((j) => j && typeof j.id === "string");
  const write = async (jobs: PhotoJob[]) => {
    await deps.meta.setMeta(PHOTO_JOBS_META_KEY, jobs);
    deps.onChange?.();
  };
  const readNotices = async () => (await deps.meta.getMeta<PhotoNotice[]>(PHOTO_NOTICES_META_KEY)) ?? [];

  // removes the job and its bytes and leaves a notice saying why (never a silent drop)
  const dropWithNotice = (job: PhotoJob, message: string) =>
    exclusive(async () => {
      await write((await read()).filter((j) => j.id !== job.id));
      await deps.meta.setMeta(blobKey(job.id), undefined);
      await deps.meta.setMeta(PHOTO_NOTICES_META_KEY, [...(await readNotices()), { id: newId(), at: now(), fileName: job.fileName, message }].slice(-20));
      deps.onChange?.();
    });

  async function flushOnce(): Promise<PhotoFlushResult> {
    const result: PhotoFlushResult = { sent: 0, dropped: 0, kept: 0, stoppedBecause: "none" };
    for (const job of await read()) {
      if (job.state !== "ready" || !job.entryId) continue;
      const bytes = await deps.meta.getMeta<Blob>(blobKey(job.id));
      if (!bytes) {
        await dropWithNotice(job, `The photo "${job.fileName}" is no longer on this laptop, so it could not be attached. Add it again from the entry while you are online.`);
        result.dropped += 1;
        continue;
      }
      try {
        await upload(job.entryId, bytes, job.fileName);
        await exclusive(async () => {
          await write((await read()).filter((j) => j.id !== job.id));
          await deps.meta.setMeta(blobKey(job.id), undefined);
        });
        result.sent += 1;
      } catch (err) {
        const status = err instanceof PhotoUploadError ? err.status : 0;
        if (status === 401) { result.stoppedBecause = "signed_out"; break; }
        if (REFUSALS.has(status)) {
          await dropWithNotice(job, `The server did not accept the photo "${job.fileName}": ${err instanceof Error && err.message ? err.message : `HTTP ${status}`}. The progress entry itself was saved.`);
          result.dropped += 1;
          continue;
        }
        if (status !== 0) await exclusive(async () => write((await read()).map((j) => (j.id === job.id ? { ...j, attempts: j.attempts + 1 } : j))));
        result.stoppedBecause = status === 0 ? "offline" : "server";
        break;
      }
    }
    result.kept = (await read()).length;
    return result;
  }

  return {
    list: read,
    async add(input) {
      const { file, fileName } = input;
      if (!file || file.size <= 0 || file.size > MAX_PHOTO_BYTES || !fileName.trim()) return null;
      const job: PhotoJob = {
        id: newId(), opId: input.opId, projectId: input.projectId, fileName: fileName.trim(), contentType: file.type || "application/octet-stream",
        size: file.size, state: "waiting_entry", at: now(), attempts: 0,
      };
      return exclusive(async () => {
        const early = ((await deps.meta.getMeta<Record<string, string>>(PHOTO_APPLIED_META_KEY)) ?? {})[input.opId];
        const kept: PhotoJob = early ? { ...job, state: "ready", entryId: early } : job;
        await deps.meta.setMeta(blobKey(job.id), file); // the bytes first: a job without bytes would be useless
        await write([...(await read()), kept]);
        return kept;
      });
    },
    entryApplied(opId, entryId) {
      return exclusive(async () => {
        const jobs = await read();
        if (!jobs.some((j) => j.opId === opId && j.state === "waiting_entry")) {
          // no photo yet for this op: remember the id (the photo may be kept a moment later), newest 50 only
          const seen = (await deps.meta.getMeta<Record<string, string>>(PHOTO_APPLIED_META_KEY)) ?? {};
          const keep = Object.entries({ ...seen, [opId]: entryId }).slice(-50);
          await deps.meta.setMeta(PHOTO_APPLIED_META_KEY, Object.fromEntries(keep));
          return;
        }
        await write(jobs.map((j) => (j.opId === opId && j.state === "waiting_entry" ? { ...j, state: "ready" as const, entryId } : j)));
      });
    },
    async entryRejected(opId) {
      for (const job of (await read()).filter((j) => j.opId === opId)) {
        await dropWithNotice(job, `The server did not accept the progress entry, so the photo "${job.fileName}" was not attached. Add the entry again, with the photo.`);
      }
    },
    async flush() {
      if (!running) {
        running = flushOnce()
          .catch((): PhotoFlushResult => ({ sent: 0, dropped: 0, kept: 0, stoppedBecause: "offline" }))
          .finally(() => { running = null; });
      }
      return running;
    },
    notices: readNotices,
    dismissNotice(id) {
      return exclusive(async () => {
        await deps.meta.setMeta(PHOTO_NOTICES_META_KEY, (await readNotices()).filter((n) => n.id !== id));
        deps.onChange?.();
      });
    },
  };
}
