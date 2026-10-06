// LOCAL-FIRST shell: the writer of the BOQ screen -- edit offline, it syncs when the laptop can reach the server.
//
// WHERE THIS SITS. docs/local-first/CONTRACT.md section 2 gives every laptop an OUTBOX of ops pushed to the backend
// (POST /push); that engine is being built on branch feat/lf-client-core (src/lib/local-first/outbox.ts) and is not in this branch.
// The shell must not depend on it, and the screen must not know which writer it has: it uses the small ShellWriter port below. THIS
// file is the interim implementation of that port, and it is deliberately honest and small:
//
//   * an edit is kept on the laptop at once (device-per-person meta key `shell:edits`) and shown at once (applyPendingEdits lays it
//     over the rows read from the replica, so a pull can never undo it before it is sent);
//   * it is SENT through the route the online BOQ screen already uses, PATCH /api/scope/line-items/<id>, so the server's own role gate and
//     rules decide (browser data is a proposal, never authority: only the person's intent -- a category -- is sent);
//   * a network failure, a 5xx, a 429 or a 401 keeps the edit and stops the run (it is tried again when the laptop is online); a 4xx
//     that is a real refusal (400/403/404/409/422) drops the edit and leaves a plain-words notice, never a retry loop.
//
// When the outbox lands, a ShellWriter backed by it replaces createEditQueue() in shell/context.ts and nothing in the screens changes.

import type { MetaStore } from "../release/installer";
// AUDIT-100 A2: the one switch between the Vercel /api routes and the projexa-api Edge Function (same contract).
import { viaPxApi } from "@/lib/px-api";

export const EDITS_META_KEY = "shell:edits";
export const NOTICES_META_KEY = "shell:edit-notices";

/** An edit of one BOQ line. `category` is the only field the online BOQ screen lets a person change on a line without a revision. */
export type PendingEdit = {
  id: string;
  lineId: string;
  boqId: string;
  projectId: string;
  patch: { category: string | null };
  /**
   * G-14: the category the person SAW when they made this edit (the first of several edits of the line keeps its own). Sent with the edit as
   * `expectedCategory`, so the server refuses it, with what is stored, if someone else changed the field meanwhile. Absent on an edit stored
   * by an older build: sent without the check, as before.
   */
  base?: { category: string | null };
  /** Set when the server said the field was changed by someone else: the edit waits here for the person's choice and is not sent. */
  conflict?: { theirs: string | null };
  at: number;
  attempts: number;
};

export type EditNotice = { id: string; at: number; lineId: string; message: string };

export type FlushResult = { sent: number; rejected: number; kept: number; stoppedBecause: "none" | "offline" | "server" | "signed_out"; conflicts?: number };

/** The port the screens write through. */
export type ShellWriter = {
  list(): Promise<PendingEdit[]>;
  enqueue(edit: { lineId: string; boqId: string; projectId: string; patch: PendingEdit["patch"]; base?: PendingEdit["base"] }): Promise<PendingEdit>;
  /** G-14: the person's choice on an edit the server refused as a conflict. "mine" sends it again on top of what is stored now; "theirs" drops it. */
  resolveConflict(editId: string, choice: "mine" | "theirs"): Promise<void>;
  /** Tries to send what is waiting. Never throws. */
  flush(): Promise<FlushResult>;
  notices(): Promise<EditNotice[]>;
  dismissNotice(id: string): Promise<void>;
};

export type EditQueueDeps = {
  meta: MetaStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  newId?: () => string;
  /** Called after the stored edits or notices changed. */
  onChange?: () => void;
};

/** What the server said, in the words it used. */
async function refusalText(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
  } catch {
    /* no JSON body */
  }
  return `The server did not accept it (HTTP ${res.status}).`;
}

const REFUSAL_STATUSES = new Set([400, 403, 404, 409, 422]);

/** G-14: what is stored now, when the server answered 409 EDIT_CONFLICT (`conflict` + `current`); undefined for any other 409. */
async function conflictCurrent(res: Response): Promise<{ category: string | null } | undefined> {
  try {
    const body = (await res.clone().json()) as { conflict?: unknown; code?: unknown; current?: { category?: unknown } };
    if ((body.conflict === "EDIT_CONFLICT" || body.code === "EDIT_CONFLICT") && body.current && typeof body.current === "object") {
      const c = body.current.category;
      return { category: typeof c === "string" ? c : null };
    }
  } catch {
    /* not JSON */
  }
  return undefined;
}

export function createEditQueue(deps: EditQueueDeps): ShellWriter {
  const doFetch = deps.fetchImpl ?? viaPxApi;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${now()}-${Math.random().toString(36).slice(2)}`));
  let running: Promise<FlushResult> | null = null;

  // Every read-modify-write of the stored edits and notices goes through this one lane, so an edit made while a flush is in flight (or
  // two edits made together) can never overwrite each other.
  let lane: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lane.then(fn, fn);
    lane = run.then(() => undefined, () => undefined);
    return run;
  };

  const readEdits = async () => ((await deps.meta.getMeta<PendingEdit[]>(EDITS_META_KEY)) ?? []).filter((e) => e && typeof e.lineId === "string");
  const writeEdits = async (edits: PendingEdit[]) => {
    await deps.meta.setMeta(EDITS_META_KEY, edits);
    deps.onChange?.();
  };
  const readNotices = async () => (await deps.meta.getMeta<EditNotice[]>(NOTICES_META_KEY)) ?? [];

  /** Takes one edit out of what is stored NOW (not out of an earlier snapshot). */
  const removeEdit = (id: string) => exclusive(async () => writeEdits((await readEdits()).filter((e) => e.id !== id)));

  async function flushOnce(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, rejected: 0, kept: 0, stoppedBecause: "none" };
    // The edits waiting when this run started; one made during the run waits for the next run.
    for (const edit of await readEdits()) {
      if (edit.conflict) { result.conflicts = (result.conflicts ?? 0) + 1; continue; } // waits for the person's choice, never resent by itself
      let res: Response;
      try {
        res = await doFetch(`/api/scope/line-items/${encodeURIComponent(edit.lineId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(edit.base ? { ...edit.patch, expectedCategory: edit.base.category } : edit.patch),
          credentials: "same-origin",
        });
      } catch {
        result.stoppedBecause = "offline"; // nothing reached the server: keep this and everything after it, in order
        break;
      }
      if (res.ok) {
        await removeEdit(edit.id);
        result.sent += 1;
        continue;
      }
      if (res.status === 401) {
        result.stoppedBecause = "signed_out"; // not a decision about the edit: it waits for the person to be signed in
        break;
      }
      if (res.status === 409) {
        // G-14: "changed by someone else". Not a refusal to drop: the person is shown both values and chooses.
        const theirs = await conflictCurrent(res);
        if (theirs !== undefined) {
          await exclusive(async () => writeEdits((await readEdits()).map((e) => (e.id === edit.id ? { ...e, conflict: { theirs: theirs.category } } : e))));
          result.conflicts = (result.conflicts ?? 0) + 1;
          continue;
        }
      }
      if (REFUSAL_STATUSES.has(res.status)) {
        const message = await refusalText(res);
        await exclusive(async () => {
          await writeEdits((await readEdits()).filter((e) => e.id !== edit.id));
          await deps.meta.setMeta(NOTICES_META_KEY, [...(await readNotices()), { id: newId(), at: now(), lineId: edit.lineId, message }].slice(-20));
          deps.onChange?.();
        });
        result.rejected += 1;
        continue;
      }
      // 5xx, 429, 408, anything else unexpected: the server is struggling, not refusing. Keep it and stop.
      await exclusive(async () => writeEdits((await readEdits()).map((e) => (e.id === edit.id ? { ...e, attempts: e.attempts + 1 } : e))));
      result.stoppedBecause = "server";
      break;
    }
    result.kept = (await readEdits()).length;
    return result;
  }

  return {
    list: readEdits,
    enqueue({ lineId, boqId, projectId, patch, base }) {
      return exclusive(async () => {
        const edits = await readEdits();
        const earlier = edits.find((e) => e.lineId === lineId);
        const edit: PendingEdit = earlier
          ? { ...earlier, patch: { ...earlier.patch, ...patch }, at: now(), attempts: 0 } // the later edit of the same line wins locally; it keeps the FIRST base and any conflict
          : { id: newId(), lineId, boqId, projectId, patch, ...(base ? { base } : {}), at: now(), attempts: 0 };
        await writeEdits(earlier ? edits.map((e) => (e.id === earlier.id ? edit : e)) : [...edits, edit]);
        return edit;
      });
    },
    resolveConflict(editId, choice) {
      return exclusive(async () => {
        const edits = await readEdits();
        const edit = edits.find((e) => e.id === editId);
        if (!edit?.conflict) return;
        if (choice === "theirs") {
          await writeEdits(edits.filter((e) => e.id !== editId)); // their value is what the server holds; the laptop's copy catches up through the change feed
          return;
        }
        // "mine": send it again as based on what is stored now, so it replaces theirs deliberately, not by accident
        const { conflict, ...rest } = edit;
        await writeEdits(edits.map((e) => (e.id === editId ? { ...rest, base: { category: conflict.theirs }, attempts: 0, at: now() } : e)));
      });
    },
    async flush() {
      // One run at a time: a second call while one is in flight shares its answer instead of sending the same edit twice.
      if (!running) {
        running = flushOnce()
          .catch((): FlushResult => ({ sent: 0, rejected: 0, kept: 0, stoppedBecause: "offline" }))
          .finally(() => { running = null; });
      }
      return running;
    },
    notices: readNotices,
    dismissNotice(id) {
      return exclusive(async () => {
        await deps.meta.setMeta(NOTICES_META_KEY, (await readNotices()).filter((n) => n.id !== id));
        deps.onChange?.();
      });
    },
  };
}

/** The rows with the person's waiting edits laid over them, so the screen shows what they just did. Rows without an edit are the same objects. */
export function applyPendingEdits<T extends { id: string; category?: string | null }>(lines: readonly T[], edits: readonly PendingEdit[]): T[] {
  if (edits.length === 0) return [...lines];
  const byLine = new Map(edits.map((e) => [e.lineId, e]));
  return lines.map((line) => {
    const edit = byLine.get(line.id);
    return edit ? { ...line, category: edit.patch.category } : line;
  });
}

// ─── when to try ────────────────────────────────────────────────────────────────────────────────

export type FlushSchedulerDeps = {
  /** Anything with a list of what waits and a flush: the BOQ edit queue, or the file queue (shell/file-queue.ts). */
  writer: { list: () => Promise<unknown[]>; flush: () => Promise<FlushResult> };
  isOnline: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** While edits wait and the laptop is online: one try per this many ms. Never faster. */
  retryMs?: number;
};

/**
 * Sends waiting edits at the right moments and no others: once at start, when the laptop comes back online (nudge()), right after an
 * edit is made (nudge()), and then at most once a minute while something is still waiting and the laptop is online. Nothing is
 * scheduled when nothing waits or the browser has no network.
 */
export function createFlushScheduler(deps: FlushSchedulerDeps) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const retryMs = deps.retryMs ?? 60_000;
  let timer: unknown = null;
  let stopped = false;

  async function run(): Promise<void> {
    timer = null;
    if (stopped || !deps.isOnline()) return;
    if ((await deps.writer.list()).length === 0) return;
    const result = await deps.writer.flush();
    if (!stopped && result.kept > 0 && deps.isOnline()) timer = setTimer(() => void run(), retryMs);
  }

  return {
    /**
     * Something may have changed: try soon, once. A pending retry timer is kept (the edit that just came in is covered by it), unless the
     * cause is the person or the network (`immediate`: the laptop came back online, the tab came back into focus), which tries now.
     */
    nudge(options: { immediate?: boolean } = {}) {
      if (stopped) return;
      if (timer !== null) {
        if (!options.immediate) return;
        clearTimer(timer);
      }
      timer = setTimer(() => void run(), 0);
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    pending: () => timer !== null,
  };
}
