// LOCAL-FIRST browser AI: window.projexa.ai -- the small, documented, async API through which the person's OWN browser
// AI (Chrome, Edge, Safari, built-in or an extension) works with PROJEXA for them, on this laptop, on the LOCAL database,
// as that person with their role (requirements R6, R8, R11, R12).
//
//   manifest()                                   who the person is, role, organisation, projects, kinds, and the
//                                                create / update / delete functions their role may use
//   list(kind, {projectId, filter, limit})       records from this laptop's copy (works offline)
//   get(kind, id)                                one record
//   search(text, {projectId})                    text search across everything on the laptop
//   create(functionId, params)                   a new record          } checked LOCALLY against the role first, then
//   update(functionId, {kind, id}, params)       a change to a record  } queued in the OUTBOX (outbox.ts) with the
//   delete(functionId, {kind, id}, params)       a removal -> a DRAFT  } optimistic local change: offline-safe
//   manual()                                     the manual for this person's role (manual.ts)
//   drafts()                                     the delete drafts waiting for the person (read-only)
//
// WHAT IS DECIDED HERE AND WHAT IS NOT. The laptop refuses, in plain words, what the role may not do (registry.ts) so
// an AI does not leave a write waiting for hours only to be refused. It never GRANTS anything: the outbox only
// proposes, and the server re-checks every op as the person with their live role (CONTRACT.md section 2).
//
// DELETES. A delete is a DRAFT the PERSON confirms with one click (AiDraftConfirm.tsx) unless the person turned on
// "let my AI act without asking" (identity.ts; default off). The confirm is deliberately NOT on this API: anything on
// window.projexa.ai can be called by the AI itself (see drafts.ts).
//
// THE SOFTWARE. Nothing here touches code, files, the service worker, the release, the cache or the configuration
// (immutability.ts proves the names on every build). Before the first call is answered the installed release is
// verified (integrity.ts); if its files were changed the whole surface switches itself OFF and reports it.
//
// Every dependency is injected (the IndexedDB factory, the outbox, the integrity check, the clock, the ids), so the
// whole thing is tested with fake-indexeddb, the real outbox and the shared fake sync server.

import { localDbNameFor, openLocalDb, type LocalDb, type LocalRecord, type LocalTx } from "../local-db";
import type { Outbox } from "../outbox";
import { MANIFEST_KEY, type StoredManifest } from "../replica";
import { createDraftStore, type AiDraft, type DraftStore } from "./drafts";
import { readIdentity, type AiIdentity } from "./identity";
import type { IntegrityReport } from "./integrity";
import { buildManual, type Manual } from "./manual";
import { CREATES_KIND, checkWrite, functionsForRank, rankOf, type RegistryFunction, type WriteAction } from "./registry";

export const AI_SURFACE_VERSION = 1;

/** A refusal or failure, always in plain words (`message`) the AI can repeat to the person. */
export class ProjexaAiError extends Error {
  readonly code: string;
  readonly missing?: string[];
  constructor(code: string, message: string, missing?: string[]) {
    super(message);
    this.name = "ProjexaAiError";
    this.code = code;
    if (missing) this.missing = missing;
  }
}

export type AiRecord = { kind: string; id: string; projectId: string | null; pending: boolean; data: unknown };
export type ListOptions = { projectId?: string; filter?: Record<string, unknown>; limit?: number };
export type RecordRef = { kind: string; id: string };

export type AiFunctionView = { id: string; label: string; module: string; params: string[]; required: string[]; moneySensitive: boolean };

export type AiManifest = {
  product: "PROJEXA";
  surfaceVersion: number;
  person: { id: string; name: string | null; role: string | null; roleRank: number };
  organisation: { id: string };
  projects: { id: string; name: string | null }[];
  kinds: string[];
  functions: Record<WriteAction, AiFunctionView[]>;
  settings: { aiActWithoutAsking: boolean };
  deletesNeedConfirmation: boolean;
  softwareCanBeChanged: false;
  integrity: IntegrityReport["status"];
  worksOffline: true;
  /** When the person's role and projects were last confirmed by the server (ms since epoch), or null. */
  identityConfirmedAt: number | null;
  note?: string;
};

export type WriteResult =
  | { status: "queued"; opId: string; tempId?: string; message: string }
  | { status: "draft"; draftId: string; message: string };

export type ProjexaAi = {
  readonly version: number;
  manifest(): Promise<AiManifest>;
  list(kind: string, options?: ListOptions): Promise<{ kind: string; items: AiRecord[]; truncated: boolean }>;
  get(kind: string, id: string): Promise<AiRecord | null>;
  search(text: string, options?: { projectId?: string }): Promise<{ items: AiRecord[]; truncated: boolean }>;
  create(functionId: string, params: Record<string, unknown>): Promise<WriteResult>;
  update(functionId: string, record: RecordRef, params: Record<string, unknown>): Promise<WriteResult>;
  delete(functionId: string, record: RecordRef, params: Record<string, unknown>): Promise<WriteResult>;
  manual(): Promise<Manual>;
  drafts(): Promise<AiDraft[]>;
};

export type AiSurfaceDeps = {
  userId: string;
  idb: IDBFactory;
  outbox: Pick<Outbox, "enqueue">;
  drafts?: DraftStore;
  /** Verifies the installed release (integrity.ts). Default: nothing installed. Run once, before the first answer. */
  integrity?: () => Promise<IntegrityReport>;
  /** Told once when the release check fails, so the page can report it. */
  onTamper?: (report: Extract<IntegrityReport, { status: "tampered" }>) => void;
  now?: () => number;
  newId?: () => string;
};

/** What the page (not the AI) gets: the API to publish, and the confirm/discard that only the person's click may call. */
export type AiSurface = {
  api: ProjexaAi;
  drafts: DraftStore;
  confirmDraft(draftId: string): Promise<WriteResult>;
  discardDraft(draftId: string): boolean;
  integrity(): Promise<IntegrityReport>;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const SEARCH_LIMIT = 50;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asObject = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : {});

type Ctx = { db: LocalDb; stored: StoredManifest; identity: AiIdentity | null; rank: number };

export function createAiSurface(deps: AiSurfaceDeps): AiSurface {
  if (!deps.userId) throw new Error("The AI surface needs the signed-in person.");
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const drafts = deps.drafts ?? createDraftStore();

  let integrityRun: Promise<IntegrityReport> | null = null;
  const integrity = () =>
    (integrityRun ??= (deps.integrity ? deps.integrity() : Promise.resolve<IntegrityReport>({ status: "not_installed", checkedAt: now() }))
      .catch((err): IntegrityReport => ({ status: "tampered", version: null, problems: [], message: `PROJEXA could not check its installed files (${err instanceof Error ? err.message : "unknown error"}), so AI access on this laptop is switched off.`, checkedAt: now() }))
      .then((report) => {
        if (report.status === "tampered") deps.onTamper?.(report);
        return report;
      }));

  async function guard(): Promise<IntegrityReport> {
    const report = await integrity();
    if (report.status === "tampered") throw new ProjexaAiError("SOFTWARE_TAMPERED", report.message);
    return report;
  }

  async function withCtx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
    await guard();
    const db = await openLocalDb(deps.idb, localDbNameFor(deps.userId));
    try {
      const stored = await db.getMeta<StoredManifest>(MANIFEST_KEY);
      if (!stored || stored.userId !== deps.userId) {
        throw new ProjexaAiError("NOT_READY", "PROJEXA has not prepared this laptop's copy of your work yet. Open PROJEXA once while connected to the internet; after that it works offline.");
      }
      let identity = await readIdentity(db, deps.userId);
      if (identity && identity.orgId !== stored.orgId) identity = null; // never mix two organisations
      return await fn({ db, stored, identity, rank: rankOf(identity?.role) });
    } finally {
      db.close();
    }
  }

  const toAiRecord = (row: LocalRecord): AiRecord => {
    const prefix = `${row.type}:`;
    return { kind: row.type, id: row.id.startsWith(prefix) ? row.id.slice(prefix.length) : row.id, projectId: row.projectId, pending: !!row.dirty, data: structuredClone(row.data) };
  };

  const requireText = (value: unknown, what: string): string => {
    if (typeof value !== "string" || !value.trim()) throw new ProjexaAiError("BAD_INPUT", `Please give ${what}.`);
    return value;
  };

  function ownProject(ctx: Ctx, projectId: unknown): string {
    if (typeof projectId !== "string" || !projectId) throw new ProjexaAiError("MISSING_PARAMS", "Every change needs projectId: the project it belongs to (manifest().projects).", ["projectId"]);
    if (!ctx.stored.projectIds.includes(projectId)) throw new ProjexaAiError("PROJECT_NOT_YOURS", "That project is not one of the projects you work on, so PROJEXA will not change it.");
    return projectId;
  }

  function decide(ctx: Ctx, functionId: unknown, action: WriteAction, params: unknown): RegistryFunction {
    if (!ctx.identity) {
      throw new ProjexaAiError("ROLE_UNKNOWN", "This laptop does not know your role yet, so it cannot make changes for you. Open PROJEXA once while connected to the internet.");
    }
    const decision = checkWrite({ functionId: requireText(functionId, "the function to use (manifest().functions)"), action, rank: ctx.rank, role: ctx.identity.role, params });
    if (!decision.ok) throw new ProjexaAiError(decision.code, decision.message, decision.missing);
    if (decision.fn.function_id === "create_project") {
      throw new ProjexaAiError("NEEDS_ONLINE", "A new project is made online: open Projects in PROJEXA while connected. Everything inside a project can be made here, offline too.");
    }
    return decision.fn;
  }

  /** The row an update/delete names: held here, this organisation's, this project's, at a known server version. */
  async function heldRow(ctx: Ctx, record: unknown, projectId: string): Promise<LocalRecord & { serverVersion: number }> {
    if (!isPlainObject(record) || typeof record.kind !== "string" || typeof record.id !== "string" || !record.kind || !record.id) {
      throw new ProjexaAiError("BAD_INPUT", "Name the record to change as {kind, id}, exactly as list() or get() returned it.");
    }
    const row = await ctx.db.getRecord(record.kind, record.id);
    if (!row || row.orgId !== ctx.stored.orgId) throw new ProjexaAiError("NOT_FOUND", `This laptop holds no ${record.kind} record "${record.id}".`);
    if (row.projectId !== projectId) throw new ProjexaAiError("WRONG_PROJECT", "That record belongs to a different project than the projectId given.");
    if (typeof row.serverVersion !== "number") {
      throw new ProjexaAiError("NOT_SYNCED", "That record has not reached the server yet. Wait until it has synced, then change it.");
    }
    return row as LocalRecord & { serverVersion: number };
  }

  async function enqueue(input: Parameters<Outbox["enqueue"]>[0]): Promise<string> {
    try {
      return (await deps.outbox.enqueue(input)).opId;
    } catch (err) {
      throw new ProjexaAiError("NOT_SAVED", `PROJEXA could not save that on this laptop: ${err instanceof Error ? err.message : "unknown error"}. Nothing was changed.`);
    }
  }

  const queuedMessage = (label: string) => `"${label}" is saved on this laptop and will reach the server when it can. The server checks it again and may still refuse it.`;

  async function queueDelete(ctx: Ctx, fn: RegistryFunction, projectId: string, params: Record<string, unknown>, row: LocalRecord & { serverVersion: number }, ref: RecordRef): Promise<WriteResult> {
    const opId = await enqueue({
      functionId: fn.function_id, projectId, params, label: `${fn.label} (asked by your AI)`,
      record: { kind: ref.kind, id: ref.id, baseVersion: row.serverVersion },
    });
    return { status: "queued", opId, message: queuedMessage(fn.label) };
  }

  const api: ProjexaAi = {
    version: AI_SURFACE_VERSION,

    async manifest() {
      const report = await guard();
      return withCtx(async (ctx) => {
        const groups = functionsForRank(ctx.identity ? ctx.rank : 0);
        const view = (f: RegistryFunction): AiFunctionView => ({ id: f.function_id, label: f.label, module: f.module, params: [...f.declared_params], required: f.required_params.map((r) => r.name), moneySensitive: f.money_sensitive });
        const names = new Map((ctx.identity?.projects ?? []).map((p) => [p.id, p.name]));
        const act = ctx.identity?.settings.aiActWithoutAsking === true;
        return {
          product: "PROJEXA",
          surfaceVersion: AI_SURFACE_VERSION,
          person: { id: deps.userId, name: ctx.identity?.name ?? null, role: ctx.identity?.role ?? null, roleRank: ctx.identity ? ctx.rank : 0 },
          organisation: { id: ctx.stored.orgId },
          projects: ctx.stored.projectIds.map((id) => ({ id, name: names.get(id) ?? null })),
          kinds: [...ctx.stored.kinds],
          functions: {
            create: groups.create.filter((f) => f.function_id !== "create_project").map(view),
            update: groups.update.map(view),
            delete: groups.delete.map(view),
          },
          settings: { aiActWithoutAsking: act },
          // A money-sensitive removal is confirmed by the person whatever the setting (delete(), below; functions[].moneySensitive).
          deletesNeedConfirmation: !act,
          softwareCanBeChanged: false,
          integrity: report.status,
          worksOffline: true,
          identityConfirmedAt: ctx.identity?.at ?? null,
          ...(ctx.identity ? {} : { note: "Your role is not known on this laptop yet, so only reading is possible until PROJEXA is opened once while connected." }),
        };
      });
    },

    async list(kind, options = {}) {
      requireText(kind, "the kind of record (manifest().kinds)");
      return withCtx(async (ctx) => {
        if (options.projectId !== undefined && !ctx.stored.projectIds.includes(options.projectId)) {
          throw new ProjexaAiError("PROJECT_NOT_YOURS", "That project is not one of the projects you work on.");
        }
        const limit = Math.min(Math.max(1, Math.floor(Number(options.limit) || DEFAULT_LIMIT)), MAX_LIMIT);
        const rows = options.projectId ? await ctx.db.listByProject(ctx.stored.orgId, kind, options.projectId) : await ctx.db.listByOrg(ctx.stored.orgId, kind);
        const filter = isPlainObject(options.filter) ? Object.entries(options.filter) : [];
        const matching = rows.filter((r) => filter.every(([field, value]) => asObject(r.data)[field] === value));
        return { kind, items: matching.slice(0, limit).map(toAiRecord), truncated: matching.length > limit };
      });
    },

    async get(kind, id) {
      requireText(kind, "the kind of record");
      requireText(id, "the record id");
      return withCtx(async (ctx) => {
        const row = await ctx.db.getRecord(kind, id);
        return row && row.orgId === ctx.stored.orgId ? toAiRecord(row) : null;
      });
    },

    async search(text, options = {}) {
      const needle = requireText(text, "words to search for").trim().toLowerCase();
      return withCtx(async (ctx) => {
        if (options.projectId !== undefined && !ctx.stored.projectIds.includes(options.projectId)) {
          throw new ProjexaAiError("PROJECT_NOT_YOURS", "That project is not one of the projects you work on.");
        }
        const rows = await ctx.db.listByOrg(ctx.stored.orgId);
        const hits: AiRecord[] = [];
        let truncated = false;
        for (const row of rows) {
          if (options.projectId && row.projectId !== options.projectId) continue;
          if (!JSON.stringify(row.data ?? null).toLowerCase().includes(needle)) continue;
          if (hits.length >= SEARCH_LIMIT) { truncated = true; break; }
          hits.push(toAiRecord(row));
        }
        return { items: hits, truncated };
      });
    },

    async create(functionId, params) {
      return withCtx(async (ctx) => {
        const fn = decide(ctx, functionId, "create", params);
        const projectId = ownProject(ctx, params.projectId);
        const kind = CREATES_KIND[fn.function_id];
        const showLocally = !!kind && ctx.stored.kinds.includes(kind);
        const tempId = showLocally ? `local-${newId()}` : undefined;
        const opId = await enqueue({
          functionId: fn.function_id, projectId, params: structuredClone(params), label: `${fn.label} (by your AI)`,
          ...(showLocally && kind && tempId
            ? {
              creates: { kind, id: tempId },
              optimistic: async (tx: LocalTx) => {
                await tx.putRecord({ id: `${kind}:${tempId}`, type: kind, orgId: ctx.stored.orgId, projectId, data: { ...structuredClone(params), id: tempId } });
              },
            }
            : {}),
        });
        return { status: "queued", opId, ...(tempId ? { tempId } : {}), message: queuedMessage(fn.label) };
      });
    },

    async update(functionId, record, params) {
      return withCtx(async (ctx) => {
        const fn = decide(ctx, functionId, "update", params);
        const projectId = ownProject(ctx, params.projectId);
        const row = await heldRow(ctx, record, projectId);
        // Only fields the row already has are changed locally (a param named like a field of the row); the server's
        // answer replaces the whole row once the op is applied.
        const idParams = new Set(["projectId", ...fn.id_params]);
        const opId = await enqueue({
          functionId: fn.function_id, projectId, params: structuredClone(params), label: `${fn.label} (by your AI)`,
          record: { kind: record.kind, id: record.id, baseVersion: row.serverVersion },
          optimistic: async (tx: LocalTx) => {
            const current = await tx.getRecord(record.kind, record.id);
            if (!current) return;
            const data = asObject(current.data);
            const patch = Object.fromEntries(Object.entries(params).filter(([k]) => !idParams.has(k) && Object.prototype.hasOwnProperty.call(data, k)));
            if (Object.keys(patch).length) await tx.patchRecord(record.kind, record.id, { data: { ...data, ...structuredClone(patch) } });
          },
        });
        return { status: "queued", opId, message: queuedMessage(fn.label) };
      });
    },

    async delete(functionId, record, params) {
      return withCtx(async (ctx) => {
        const fn = decide(ctx, functionId, "delete", params);
        const projectId = ownProject(ctx, params.projectId);
        const row = await heldRow(ctx, record, projectId);
        // lf-e11: a money-sensitive removal (a receipt's value, a BOQ, attendance cost) is ALWAYS confirmed by the person, even with
        // "act without asking" on: that switch is about routine changes, never about money.
        if (ctx.identity?.settings.aiActWithoutAsking === true && !fn.money_sensitive) return queueDelete(ctx, fn, projectId, structuredClone(params), row, record);
        const draftId = `draft-${newId()}`;
        const data = asObject(row.data);
        const name = [data.title, data.name, data.subject, data.number, data.item_code].find((v) => typeof v === "string" || typeof v === "number");
        drafts.add({
          draftId, functionId: fn.function_id, label: fn.label, projectId, params: structuredClone(params),
          record: { kind: record.kind, id: record.id },
          summary: `Your AI asks to "${fn.label}"${name !== undefined ? `: ${String(name)}` : ` (${record.kind} ${record.id})`}.`,
          createdAt: now(),
        });
        return { status: "draft", draftId, message: `Nothing was removed yet. The person must confirm "${fn.label}" with one click in PROJEXA.` };
      });
    },

    async manual() {
      return withCtx(async (ctx) => buildManual({ rank: ctx.identity ? ctx.rank : 0, role: ctx.identity?.role ?? null }));
    },

    async drafts() {
      await guard();
      return drafts.list();
    },
  };

  return {
    api: Object.freeze(api),
    drafts,
    /** Only the page's own confirm button calls this (never the AI). The role is checked again: it may have changed. */
    async confirmDraft(draftId) {
      const draft = drafts.get(draftId);
      if (!draft) throw new ProjexaAiError("NOT_FOUND", "That request is no longer waiting.");
      const result = await withCtx(async (ctx) => {
        const fn = decide(ctx, draft.functionId, "delete", draft.params);
        const projectId = ownProject(ctx, draft.params.projectId);
        const row = await heldRow(ctx, draft.record, projectId);
        return queueDelete(ctx, fn, projectId, draft.params, row, draft.record);
      });
      drafts.remove(draftId);
      return result;
    },
    discardDraft: (draftId) => drafts.remove(draftId),
    integrity,
  };
}
