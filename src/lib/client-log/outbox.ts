// The device outbox: events wait here, on the person's own device (IndexedDB, localStorage as the fallback), until they can be sent.
//   * survives going offline and reloading the page
//   * errors are sent within ~5 s, actions every ~60 s (or when the page is hidden), at most 50 per request
//   * 429 / 5xx / network failure -> exponential back-off; 401/403 -> pause (signed out) until resume()
//   * when the store is full (500) the OLDEST ACTION goes first; an error is never dropped to make room (see enqueue)
// Nothing runs while nothing happens: there is no polling timer, only one timer armed by an event or a back-off.

import { isErrorEvent, type ClientLogEvent, type SendResult } from "./types";

export const OUTBOX_MAX = 500;
/** Safety ceiling so a runaway cannot fill a phone: beyond this only warning-level lines are shed. Errors (severity "error") are never shed. */
export const OUTBOX_HARD_CEILING = 2000;
export const BATCH_SIZE = 50;
export const ERROR_DELAY_MS = 5_000;
export const ACTION_DELAY_MS = 60_000;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export type OutboxStore = {
  loadAll(): Promise<ClientLogEvent[]>;
  put(event: ClientLogEvent): Promise<void>;
  remove(ids: string[]): Promise<void>;
};

type Timer = unknown;
export type OutboxDeps = {
  store: OutboxStore;
  send: (events: ClientLogEvent[]) => Promise<SendResult>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
  isOnline?: () => boolean;
  /** False on the sign-in / marketing pages: nothing is sent, nothing is asked of the server. */
  canSend?: () => boolean;
  max?: number;
  batch?: number;
};

export function createOutbox(deps: OutboxDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const isOnline = deps.isOnline ?? (() => true);
  const canSend = deps.canSend ?? (() => true);
  const max = deps.max ?? OUTBOX_MAX;
  const batch = deps.batch ?? BATCH_SIZE;

  let items: ClientLogEvent[] = [];
  let paused = false;
  let flushing = false;
  let attempts = 0;
  let backoffUntil = 0;
  let timer: Timer | null = null;
  let timerAt = 0;

  const ready: Promise<void> = deps.store
    .loadAll()
    .then((stored) => {
      const have = new Set(items.map((i) => i.id));
      const older = stored.filter((s) => !have.has(s.id));
      items = [...older, ...items].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
      if (items.length) arm(ERROR_DELAY_MS);
    })
    .catch(() => {});

  function persist(fn: () => Promise<void>) {
    try {
      void fn().catch(() => {});
    } catch {
      /* storage blocked: the in-memory copy still holds */
    }
  }

  function arm(delayMs: number) {
    const due = Math.max(now() + delayMs, backoffUntil);
    if (timer !== null && timerAt <= due) return;
    if (timer !== null) clearTimer(timer);
    timerAt = due;
    timer = setTimer(() => {
      timer = null;
      timerAt = 0;
      void flush().catch(() => {});
    }, Math.max(0, due - now()));
  }

  function evictIfOver() {
    // 1) over the normal cap: the oldest ACTION goes first, one at a time.
    while (items.length > max) {
      const i = items.findIndex((e) => !isErrorEvent(e));
      if (i < 0) break;
      const [gone] = items.splice(i, 1);
      persist(() => deps.store.remove([gone!.id]));
    }
    // 2) still over with nothing but errors: errors stay (the cap is soft for them). Only past the hard ceiling are
    //    warning-level lines (console noise) shed, oldest first. A severity "error" event is never removed here.
    while (items.length > OUTBOX_HARD_CEILING) {
      const i = items.findIndex((e) => e.severity === "warning");
      if (i < 0) break;
      const [gone] = items.splice(i, 1);
      persist(() => deps.store.remove([gone!.id]));
    }
  }

  function enqueue(event: ClientLogEvent) {
    items.push(event);
    persist(() => deps.store.put(event));
    evictIfOver();
    arm(isErrorEvent(event) ? ERROR_DELAY_MS : ACTION_DELAY_MS);
  }

  /** Update a still-waiting event (the repeat count of a burst). A no-op once it has been sent. */
  function patch(id: string, fn: (e: ClientLogEvent) => ClientLogEvent) {
    const i = items.findIndex((e) => e.id === id);
    if (i < 0) return false;
    items[i] = fn(items[i]!);
    const next = items[i]!;
    persist(() => deps.store.put(next));
    return true;
  }

  function nextBatch(): ClientLogEvent[] {
    // errors first, so a problem is never queued behind a pile of routine actions
    const errs = items.filter(isErrorEvent);
    const acts = items.filter((e) => !isErrorEvent(e));
    return [...errs, ...acts].slice(0, batch);
  }

  function drop(ids: Set<string>) {
    items = items.filter((e) => !ids.has(e.id));
    persist(() => deps.store.remove([...ids]));
  }

  function backOff(retryAfterMs?: number) {
    attempts += 1;
    const wait = Math.max(retryAfterMs ?? 0, Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1)));
    backoffUntil = now() + wait;
    arm(wait);
  }

  async function flush(): Promise<void> {
    await ready;
    if (flushing || paused || !items.length) return;
    if (!canSend() || !isOnline()) return; // the "online" event / next page load calls flush again
    if (now() < backoffUntil) return arm(backoffUntil - now());
    flushing = true;
    try {
      while (items.length && !paused) {
        const events = nextBatch();
        let res: SendResult;
        try {
          res = await deps.send(events);
        } catch {
          backOff();
          return;
        }
        if (res.status >= 200 && res.status < 300) {
          // accepted AND individually-rejected events both leave: a rejected one can never succeed, resending it would loop for ever.
          drop(new Set(events.map((e) => e.id)));
          attempts = 0;
          backoffUntil = 0;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          paused = true; // signed out: keep everything, ask nothing more until resume()
          return;
        }
        if (res.status === 400 || res.status === 413 || res.status === 422) {
          // the server says this exact batch can never be accepted (malformed): drop it rather than loop on it for ever.
          drop(new Set(events.map((e) => e.id)));
          continue;
        }
        // 429, 5xx, 404 (backend not there yet), anything unexpected: keep everything and try later.
        backOff(res.retryAfterMs);
        return;
      }
    } finally {
      flushing = false;
    }
  }

  /** Page is going away: hand the next batches to the browser's beacon (cannot be awaited). Removed only if the browser took them. */
  function flushOnHide(beacon: (events: ClientLogEvent[]) => boolean) {
    if (paused || !items.length || !canSend() || !isOnline() || now() < backoffUntil) return;
    try {
      const events = nextBatch();
      if (events.length && beacon(events)) drop(new Set(events.map((e) => e.id)));
    } catch {
      /* ignore */
    }
  }

  return {
    enqueue,
    patch,
    flush,
    flushOnHide,
    ready,
    resume() {
      paused = false;
      attempts = 0;
      backoffUntil = 0;
      if (items.length) arm(ERROR_DELAY_MS);
    },
    onOnline() {
      if (items.length) arm(0);
    },
    size: () => items.length,
    pending: () => items.map((e) => ({ ...e })),
    isPaused: () => paused,
    backoffUntil: () => backoffUntil,
  };
}
export type Outbox = ReturnType<typeof createOutbox>;

// ---- stores -------------------------------------------------------------------------------------------------------------------------

export const OUTBOX_LS_KEY = "px-client-log-outbox";

export function createLocalStorageStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined, key = OUTBOX_LS_KEY): OutboxStore {
  const read = (): ClientLogEvent[] => {
    try {
      const v = JSON.parse(storage?.getItem(key) ?? "[]");
      return Array.isArray(v) ? (v as ClientLogEvent[]) : [];
    } catch {
      return [];
    }
  };
  const write = (list: ClientLogEvent[]) => {
    try {
      if (list.length) storage?.setItem(key, JSON.stringify(list));
      else storage?.removeItem(key);
    } catch {
      /* quota: the in-memory outbox still holds it */
    }
  };
  return {
    async loadAll() {
      return read();
    },
    async put(e) {
      const list = read().filter((x) => x.id !== e.id);
      list.push(e);
      write(list);
    },
    async remove(ids) {
      const gone = new Set(ids);
      write(read().filter((x) => !gone.has(x.id)));
    },
  };
}

const IDB_NAME = "px-client-log";
const IDB_STORE = "outbox";

/** IndexedDB store. Any failure to open it rejects, and openBestStore() then falls back to localStorage. */
export function createIdbStore(factory: IDBFactory): OutboxStore {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
      req.onblocked = () => reject(new Error("indexedDB blocked"));
    }));
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest[] | void): Promise<T | undefined> => {
    const db = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const r = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(!Array.isArray(r) && r ? (r.result as T) : undefined);
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
    });
  };
  return {
    async loadAll() {
      return ((await run<ClientLogEvent[]>("readonly", (s) => s.getAll())) ?? []) as ClientLogEvent[];
    },
    async put(e) {
      await run("readwrite", (s) => s.put(e));
    },
    async remove(ids) {
      await run("readwrite", (s) => ids.map((id) => s.delete(id)));
    },
  };
}

/**
 * IndexedDB when it opens, else localStorage. Decided once, up front, so a failure later cannot split the events across two places.
 * LAZY: the database is not created until the first event is written. A browser that has never had anything to report (a brand-new
 * machine, a person with no problems) gets no database at all -- zero cost when nothing happens. On start-up an existing database is
 * read to resume what an earlier page left; if the browser cannot say whether one exists (no indexedDB.databases()), it is opened as before.
 */
export function createBestStore(win: { indexedDB?: IDBFactory; localStorage?: Storage }): OutboxStore {
  const ls = createLocalStorageStore(safeLocalStorage(win));
  if (!win.indexedDB) return ls;
  const factory = win.indexedDB;
  const idb = createIdbStore(factory);
  let chosen: Promise<OutboxStore> | null = null;
  const pick = () =>
    (chosen ??= idb
      .loadAll()
      .then(() => idb)
      .catch(() => ls));
  const exists = async (): Promise<boolean> => {
    try {
      if (typeof factory.databases !== "function") return true;
      return (await factory.databases()).some((d) => d.name === IDB_NAME);
    } catch {
      return true;
    }
  };
  return {
    loadAll: async () => ((await exists()) ? (await pick()).loadAll() : []),
    put: async (e) => (await pick()).put(e),
    remove: async (ids) => ((await exists()) ? (await pick()).remove(ids) : undefined),
  };
}

function safeLocalStorage(win: { localStorage?: Storage }): Storage | null {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}
