// LOCAL-FIRST shell, documents cluster: FILE BODIES on the laptop (a drawing's PDF, a permit's scan, a document's image).
//
// THE DECISION. The replica carries a document's details, never its file (the sync projection has no URL or storage path, and the bucket
// is private: every online screen asks the server to sign a short-lived URL). Copying every file of every project to every laptop would
// cost the owner Storage egress for files nobody opens, so NOTHING is downloaded in the background. Instead:
//   1. "Keep on this laptop" (pinned): the person asks for one file, while online; it is fetched ONCE and stays until they remove it.
//   2. Recent files (automatic, size-capped): a file the person opened online through the shell is kept too, and the least recently
//      opened ones are dropped once the recent files pass RECENT_CAP_BYTES. Pinned files never count against that cap or get dropped.
//   Offline, the screen shows the kept copy if there is one, and otherwise says plainly that the file was not kept on this laptop.
//   Cost: one download per file the person actually opens, the same download the online screen already makes. Nothing else.
//
// WHERE. A separate IndexedDB database per person, `projexa-files:<userId>` (store `files`, key = document id), so the client engine's
// own database (local-db.ts, owned by another package) is not touched and a large file never slows a replica transaction. Sign-out must
// delete it with deleteFileCache(userId): see the package report (sign-out.ts is not this package's file).
//
// SAFETY. A kept file is shown only next to a document row the person can still read on this laptop (the screens look it up by the row
// they already hold, and pruneFileCache drops files whose row is gone: deleted, or no longer visible to their role). A row of another
// organisation or project never matches (organisation and project are stored with the file and checked on read). External links (a 3D
// walkthrough URL) are never downloaded: they are somewhere else by definition. The bytes are stored as an ArrayBuffer plus its type.

export const FILES_STORE = "files";
export const FILE_DB_VERSION = 1;
/** Pinned files: the most one person may keep on purpose. */
export const PINNED_CAP_BYTES = 500 * 1024 * 1024;
/** Recently opened files: the least recently opened are dropped beyond this. */
export const RECENT_CAP_BYTES = 150 * 1024 * 1024;
/** One file above this is never kept (a drawing set of this size is for the online viewer). */
export const MAX_FILE_BYTES = 60 * 1024 * 1024;

export const fileDbNameFor = (userId: string): string => `projexa-files:${userId}`;

export type KeptFile = {
  docId: string;
  orgId: string;
  projectId: string;
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
  pinned: boolean;
  keptAt: number;
  openedAt: number;
};

export type KeptFileInfo = Omit<KeptFile, "bytes">;

export type FileOwner = { orgId: string; projectId: string };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

async function openFileDb(idb: IDBFactory, userId: string): Promise<IDBDatabase> {
  const open = idb.open(fileDbNameFor(userId), FILE_DB_VERSION);
  open.onupgradeneeded = () => {
    if (!open.result.objectStoreNames.contains(FILES_STORE)) open.result.createObjectStore(FILES_STORE, { keyPath: "docId" });
  };
  return req(open);
}

const info = ({ bytes: _bytes, ...rest }: KeptFile): KeptFileInfo => rest;

export type FileCache = {
  /** The kept file of this document, only if it was kept for the same organisation and project. Marks it as just opened. */
  get(docId: string, owner: FileOwner): Promise<KeptFile | null>;
  /** What is kept, without the bytes. */
  list(): Promise<KeptFileInfo[]>;
  /** Stores a file (pinned or recent), then drops the oldest recent files beyond the cap. Refuses what would break a cap. */
  put(file: Omit<KeptFile, "keptAt" | "openedAt" | "size"> & { size?: number }): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Keeps an already kept file for good (or lets it become an ordinary recent file again). */
  setPinned(docId: string, pinned: boolean): Promise<void>;
  remove(docId: string): Promise<void>;
  /** Drops every kept file whose document is not in `liveDocIds` (deleted, or no longer visible to this person). Returns how many. */
  prune(liveDocIds: ReadonlySet<string>, scope?: FileOwner): Promise<number>;
  close(): void;
};

export type FileCaps = { pinned: number; recent: number; maxFile: number };
export const DEFAULT_FILE_CAPS: FileCaps = { pinned: PINNED_CAP_BYTES, recent: RECENT_CAP_BYTES, maxFile: MAX_FILE_BYTES };

export async function openFileCache(userId: string, deps: { idb?: IDBFactory; now?: () => number; caps?: FileCaps } = {}): Promise<FileCache> {
  const idb = deps.idb ?? globalThis.indexedDB;
  const now = deps.now ?? (() => Date.now());
  const caps = deps.caps ?? DEFAULT_FILE_CAPS;
  const db = await openFileDb(idb, userId);

  async function all(): Promise<KeptFile[]> {
    const tx = db.transaction(FILES_STORE, "readonly");
    return (await req(tx.objectStore(FILES_STORE).getAll())) as KeptFile[];
  }

  return {
    async get(docId, owner) {
      const tx = db.transaction(FILES_STORE, "readwrite");
      const store = tx.objectStore(FILES_STORE);
      const file = (await req(store.get(docId))) as KeptFile | undefined;
      if (!file || file.orgId !== owner.orgId || file.projectId !== owner.projectId) {
        await txDone(tx);
        return null;
      }
      const touched = { ...file, openedAt: now() };
      store.put(touched);
      await txDone(tx);
      return touched;
    },
    async list() {
      return (await all()).map(info);
    },
    async put(input) {
      const size = input.bytes.byteLength;
      if (size === 0) return { ok: false, message: "The file is empty." };
      if (size > caps.maxFile) return { ok: false, message: `This file is too large to keep on this laptop (over ${Math.max(1, Math.round(caps.maxFile / 1024 / 1024))} MB). Open it online.` };
      const existing = await all();
      const others = existing.filter((f) => f.docId !== input.docId);
      if (input.pinned) {
        const pinnedTotal = others.filter((f) => f.pinned).reduce((s, f) => s + f.size, 0);
        if (pinnedTotal + size > caps.pinned) return { ok: false, message: "This laptop already keeps as many files as it may. Remove a kept file first." };
      }
      const previous = existing.find((f) => f.docId === input.docId);
      const file: KeptFile = { ...input, size, pinned: input.pinned || Boolean(previous?.pinned), keptAt: previous?.keptAt ?? now(), openedAt: now() };
      // Recent (unpinned) files beyond the cap: the least recently opened go first, never the one just kept.
      const recent = [...others.filter((f) => !f.pinned), ...(file.pinned ? [] : [file])].sort((a, b) => b.openedAt - a.openedAt);
      const drop: string[] = [];
      let total = 0;
      for (const f of recent) {
        total += f.size;
        if (total > caps.recent && f.docId !== file.docId) drop.push(f.docId);
      }
      const tx = db.transaction(FILES_STORE, "readwrite");
      const store = tx.objectStore(FILES_STORE);
      store.put(file);
      for (const id of drop) store.delete(id);
      await txDone(tx);
      return { ok: true };
    },
    async setPinned(docId, pinned) {
      const tx = db.transaction(FILES_STORE, "readwrite");
      const store = tx.objectStore(FILES_STORE);
      const file = (await req(store.get(docId))) as KeptFile | undefined;
      if (file) store.put({ ...file, pinned });
      await txDone(tx);
    },
    async remove(docId) {
      const tx = db.transaction(FILES_STORE, "readwrite");
      tx.objectStore(FILES_STORE).delete(docId);
      await txDone(tx);
    },
    async prune(liveDocIds, scope) {
      const stale = (await all()).filter((f) => (!scope || (f.orgId === scope.orgId && f.projectId === scope.projectId)) && !liveDocIds.has(f.docId));
      if (stale.length === 0) return 0;
      const tx = db.transaction(FILES_STORE, "readwrite");
      for (const f of stale) tx.objectStore(FILES_STORE).delete(f.docId);
      await txDone(tx);
      return stale.length;
    },
    close() {
      db.close();
    },
  };
}

/** Removes every kept file of this person (sign-out). Never throws. */
export async function deleteFileCache(userId: string, idb: IDBFactory = globalThis.indexedDB): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const r = idb.deleteDatabase(fileDbNameFor(userId));
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
      r.onblocked = () => resolve();
    });
  } catch {
    /* nothing kept, or storage unavailable: nothing to remove */
  }
}

// ─── fetching a file, ONLINE only, through the routes the online screens already use ─────────────────────────────

/** Which online route signs the file's URL: the same one the online screen of that module calls. */
export type FileSource = {
  module: "documents" | "drawings" | "permits";
  docId: string;
  /** The laptop's row says this document is a link to somewhere else (metadata isExternalLink): never download it. */
  external?: boolean;
};

export function signingRoute(source: FileSource): string {
  const id = encodeURIComponent(source.docId);
  if (source.module === "drawings") return `/api/drawings/${id}/document-url`;
  if (source.module === "permits") return `/api/permits/${id}`;
  return `/api/documents/${id}`;
}

export type FetchedFile = { kind: "file"; bytes: ArrayBuffer; type: string } | { kind: "external"; url: string } | { kind: "none"; message: string };

/**
 * Asks the server for the file's short-lived signed URL (the online screen's own route, so the server's role gate decides), then fetches
 * the bytes. Never called offline; never throws: a failure is a plain message.
 */
export async function fetchDocumentFile(source: FileSource, deps: { fetchImpl?: typeof fetch } = {}): Promise<FetchedFile> {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  try {
    const res = await doFetch(signingRoute(source), { headers: { accept: "application/json" } });
    if (res.status === 401 || res.status === 403 || res.status === 404) return { kind: "none", message: "The server did not give this file to you. It may have been removed, or your access changed." };
    if (!res.ok) return { kind: "none", message: "The server could not give the file right now. Try again in a minute." };
    const body = (await res.json()) as Record<string, unknown>;
    const url = typeof body.signedUrl === "string" ? body.signedUrl : typeof body.documentUrl === "string" ? body.documentUrl : null;
    if (!url) return { kind: "none", message: "There is no file behind this record." };
    if (body.isExternalLink === true || source.external === true) return { kind: "external", url };
    const file = await doFetch(url);
    if (!file.ok) return { kind: "none", message: "The file could not be downloaded right now. Try again in a minute." };
    const bytes = await file.arrayBuffer();
    return { kind: "file", bytes, type: file.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream" };
  } catch {
    return { kind: "none", message: "The file could not be downloaded (no connection?). It will be available once you are online." };
  }
}
