// LOCAL-FIRST "AS PER ROLE" (package lf-e7, requirements R4 / G5 / R12): what the laptop holds is re-evaluated whenever the person's
// role, the organisation's cost-visibility setting or the server's data epoch changes. The server cuts every row for a VIEW CLASS
// (drizzle/0678 `view_class` for the project kinds, 0684 `org_view_class` for the organisation kinds: a fingerprint of the role's
// gate and hidden columns), and numbers every row with a version that is only meaningful within one EPOCH (0679). So:
//
//   * a class is recorded per project (and for the organisation under ORG_PROJECT) when its rows are pulled; a manifest, a page or
//     /heads that names ANOTHER class means the rows already here were redacted for another role: the project's rows are dropped
//     and pulled again (`resetProject`);
//   * a kind the role may no longer read (an organisation kind that left the manifest's `org_kinds`) leaves the laptop;
//   * a new epoch means every version and cursor here is meaningless: every project is reset (`resetEverything`);
//   * a feed's `reset_required` resets that one project.
// Every one of these is automatic and silent, and NONE of them may lose a pending edit or a draft: rows with a pending local edit are
// never dropped (local-db.ts refuses to delete a dirty row unless asked with `{local: true}`, which nothing here does), and the outbox
// and the drafts stores are never touched.
//
// DECISION (cost first): a project whose rows were pulled by a build older than this one has no recorded class; its class is recorded
// as the current one WITHOUT a reset, so an update does not re-download every laptop's whole copy. The rows were cut by the same
// server for the same person; a role change before the update is caught by the next page that carries the class.
//
// Pure apart from the injected LocalDb (meta and record calls only).

import { changeCursorKey, reconcileKey, type LocalDb } from "./local-db";
import { ORG_PROJECT } from "./sync-client";

export { ORG_PROJECT };

/** The class the rows of a project (or ORG_PROJECT) were cut for. */
export const classKey = (projectId: string) => `sync:class:${projectId}`;
/** The server epoch every stored version and cursor belongs to. */
export const EPOCH_KEY = "sync:epoch";
/** When the organisation was last checked by a one-project run (replica.ts, at most hourly). */
export const ORG_CHECK_KEY = "sync:org-check";

export type StoredClass = { view: string; at: number };

// Same layout as replica.ts cursorKey / doneKey (not imported: replica.ts imports this file).
const cursorKeyOf = (projectId: string, kind: string) => `sync:cursor:${projectId}:${kind}`;
const doneKeyOf = (projectId: string, kind: string) => `sync:done:${projectId}:${kind}`;

/** The error a replica step throws to say "stop storing this, the rules below must run first". Never reaches a screen. */
export type ClassSignal = Error & { replicaReason: "class_changed" | "epoch_changed" | "reset_required"; projectId?: string; epoch?: string };

export function classSignal(reason: ClassSignal["replicaReason"], extra: { projectId?: string; epoch?: string } = {}): ClassSignal {
  const words = reason === "class_changed" ? "Your access changed; this copy is being refreshed."
    : reason === "epoch_changed" ? "The server's data was restored; this copy is being refreshed."
      : "This project's copy is too old to update; it is being refreshed.";
  return Object.assign(new Error(words), { replicaReason: reason }, extra) as ClassSignal;
}

export function isClassSignal(err: unknown): err is ClassSignal {
  const r = (err as { replicaReason?: unknown } | null)?.replicaReason;
  return r === "class_changed" || r === "epoch_changed" || r === "reset_required";
}

/** The class a page was cut for: `org_view_class` for the organisation, `view_class` for a project. Undefined: the service did not say. */
export function pageClass(projectId: string, page: { view_class?: string; org_view_class?: string }): string | undefined {
  return projectId === ORG_PROJECT ? page.org_view_class : page.view_class;
}

/**
 * Throws a `class_changed` signal when a page names a class other than the one recorded for its project. Called BEFORE the page is
 * stored, so rows cut for two different roles never sit side by side. No recorded class, or no class on the page: nothing to compare.
 */
export async function assertPageClass(db: Pick<LocalDb, "getMeta">, projectId: string, page: { view_class?: string; org_view_class?: string }): Promise<void> {
  const cls = pageClass(projectId, page);
  if (!cls) return;
  const stored = await db.getMeta<StoredClass | null>(classKey(projectId));
  if (stored && typeof stored.view === "string" && stored.view !== cls) throw classSignal("class_changed", { projectId });
}

/**
 * Drops what the laptop holds of one project (non-dirty rows only) and every position of it, so its next pull is a whole, fresh copy.
 * `kinds` are the kinds whose cursors are cleared (pass every kind ever synced for it). Returns the number of rows removed.
 */
export async function resetProject(db: LocalDb, orgId: string, projectId: string, kinds: readonly string[]): Promise<number> {
  const removed = await db.deleteByProject(orgId, projectId); // skips every dirty row (local-db.ts)
  for (const kind of new Set(kinds)) {
    await db.setMeta(cursorKeyOf(projectId, kind), null);
    await db.setMeta(doneKeyOf(projectId, kind), null);
    await db.setMeta(reconcileKey(projectId, kind), null);
  }
  await db.setMeta(changeCursorKey(projectId), null);
  // the recorded class is left as it is: a class change records the new one itself (applyClasses), an epoch or reset_required does not change it
  return removed;
}

/** Drops one kind of one project (a kind the role may no longer read). Dirty rows stay. */
export async function dropKind(db: LocalDb, orgId: string, projectId: string, kind: string): Promise<number> {
  const rows = await db.listByProject(orgId, kind, projectId);
  const removed = await db.deleteRecords(rows.filter((r) => !r.dirty).map((r) => r.id));
  await db.setMeta(cursorKeyOf(projectId, kind), null);
  await db.setMeta(doneKeyOf(projectId, kind), null);
  await db.setMeta(reconcileKey(projectId, kind), null);
  return removed;
}

export type ClassPlan = {
  orgId: string;
  /** Every project the manifest lists, with the class the server cuts its rows for now (the manifest's view_class). */
  projects: readonly string[];
  viewClass: string | null | undefined;
  /** ORG_PROJECT's class now (the manifest's org_view_class); undefined/null: the service does not say (nothing compared). */
  orgViewClass: string | null | undefined;
  /** Every project kind and every organisation kind ever synced here (cursor keys of all of them are cleared on a reset). */
  projectKinds: readonly string[];
  orgKinds: readonly string[];
  /** The organisation kinds the role may read now, and those it could read before (the stored manifest). */
  orgKindsNow: readonly string[];
  orgKindsBefore: readonly string[];
  now: number;
};

export type ClassOutcome = { reset: string[]; droppedKinds: string[]; removed: number };

/**
 * The manifest's view of the person, applied: projects (and the organisation) whose recorded class differs are reset, organisation
 * kinds the role may no longer read are dropped, and the current classes are recorded. Run BEFORE any pull of the run.
 */
export async function applyClasses(db: LocalDb, plan: ClassPlan): Promise<ClassOutcome> {
  const out: ClassOutcome = { reset: [], droppedKinds: [], removed: 0 };
  const now = new Set(plan.orgKindsNow);
  for (const kind of plan.orgKindsBefore) {
    if (now.has(kind)) continue;
    out.removed += await dropKind(db, plan.orgId, ORG_PROJECT, kind);
    out.droppedKinds.push(kind);
  }
  const targets: Array<[string, string | null | undefined, readonly string[]]> = plan.projects.map((p) => [p, plan.viewClass, plan.projectKinds]);
  targets.push([ORG_PROJECT, plan.orgViewClass, plan.orgKinds]);
  for (const [projectId, cls, kinds] of targets) {
    if (!cls) continue;
    const stored = await db.getMeta<StoredClass | null>(classKey(projectId));
    if (stored && typeof stored.view === "string" && stored.view !== cls) {
      out.removed += await resetProject(db, plan.orgId, projectId, kinds);
      out.reset.push(projectId);
    }
    if (!stored || stored.view !== cls) await db.setMeta(classKey(projectId), { view: cls, at: plan.now } satisfies StoredClass);
  }
  return out;
}

export type EpochVerdict = "same" | "first" | "changed" | "unknown";

/** Compares an epoch the server named with the stored one. "first" stores it; "changed" stores nothing (the caller resets first). */
export async function noteEpoch(db: Pick<LocalDb, "getMeta" | "setMeta">, epoch: string | null | undefined): Promise<EpochVerdict> {
  if (!epoch) return "unknown";
  const stored = await db.getMeta<string | null>(EPOCH_KEY);
  if (typeof stored !== "string" || stored === "") {
    await db.setMeta(EPOCH_KEY, epoch);
    return "first";
  }
  return stored === epoch ? "same" : "changed";
}

/** A new epoch: every project and the organisation are reset (dirty rows, the outbox and drafts stay), then the new epoch is recorded. */
export async function resetEverything(db: LocalDb, orgId: string, projects: readonly string[], kinds: readonly string[], epoch: string): Promise<number> {
  let removed = 0;
  for (const p of new Set([...projects, ORG_PROJECT])) removed += await resetProject(db, orgId, p, kinds);
  await db.setMeta(EPOCH_KEY, epoch);
  return removed;
}
