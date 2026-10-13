// LOCAL-FIRST shell, Scope of Work (BOQ): the two writes a person can make with the network off -- a NEW BOQ and a NEW REVISION.
//
// EVERY WRITE IS A PROPOSAL (as design-change-writes.ts): ONE op in this person's outbox, sent when the laptop can reach the server, run
// through the AI work link's real pipeline under the person's LIVE role. The function ids and parameter names are the registry's:
//
//   create_boq           {projectId, title, lineItems?, idempotency_key}                                       rank 2
//   create_boq_revision  {projectId, boqId, title?, lineItems, allowScopeReductionOverride?}                   rank 2
//
// THE RULES ARE THE SERVER'S, CHECKED AGAIN HERE. The person is told at once, in the online screen's words, what the server would refuse
// (nothing is kept on the laptop then): the same collectLines()/lineMissingFields() the online New BOQ screen uses, plus the three
// structural rules the server (construction-boq-service.ts validateLineItemInputs / deriveLineItemQuantityAndRate) applies to the whole set:
// a parent code that matches no line, a circular parent chain, a repeated item code. The server runs every rule again on arrival and its
// word is final: a refusal then comes back as a card in the outbox ("kept on this laptop, not accepted"), the optimistic row is removed.
//   - line amount = QTY x RATE; a sub-task's amount = ROOT qty x ROOT rate x breakdown % (its own qty / rate are ignored); weights are NOT
//     forced to add up to 100; the BOQ total counts root lines only (boq-helpers.ts draftLineAmount / draftBoqTotal);
//   - a revision lists EVERY line it keeps (a line left out is removed). Its variation is the difference of all line amounts against the
//     revision it is made from (the server's variation_vs_prior, which keeps sub-task amounts so a breakdown-% change registers);
//   - removing a line that has progress, or reducing it (a negative change in its amount), is BLOCKED -- refused here from the progress this
//     laptop holds, and by the server from its own (SCOPE_REDUCTION_BLOCKED) when the laptop's copy was behind. The explicit override of the
//     online screen stays online: it is a decision the person must see the lines for.
//
// WHAT THE LAPTOP KEEPS: ONE `boqs` row with a temporary id (the outbox removes it when the server accepts or refuses), carrying the lines
// as the person typed them in `local_lines`; the Scope screens draw it marked "Waiting to sync". Nothing computed here is sent as authority:
// only the person's lines are, and the server stores its own figures.
//
// Excel import now works here too: the workbook is read ON THE LAPTOP (boq-excel/) and fills the New BOQ grid, which then keeps an ordinary create_boq.

import { localDbNameFor, openLocalDb } from "../../local-db";
import { OutboxRefusal } from "../../outbox";
import {
  collectLines, draftBoqTotal, draftLineAmount, draftRootAncestor, emptyLine, TITLE_REQUIRED_MESSAGE, toDrafts, toPayloadLineItems,
  type BoqLineItemRow, type LineItemDraft,
} from "@/lib/boq-helpers";
import { BOQ_LINES_KIND, BOQS_KIND } from "../../boq-local";
import { editableRow, ready, tempIdOf, type DesignChangeWriteAccess } from "./design-change-writes";

export { emptyLine };

export type ScopeWriteResult =
  | { queued: true; opId: string; tempId: string }
  | { queued: false; reason: "no_copy" | "no_row" | "invalid" | "blocked" | "too_large" | "failed" | "revision_waiting" | "change_order" };

const trim = (s: string | undefined) => (s ?? "").trim();

export type BoqDraftErrors = { title?: string; lines?: string };

/**
 * The checks the online save makes (and the server's three set-wide rules), in plain words. Empty object = fine. A BOQ with no lines at all is
 * legitimate (a title and nothing else, R-03).
 */
export function validateBoqDraft(title: string, lines: LineItemDraft[]): BoqDraftErrors {
  const errors: BoqDraftErrors = {};
  if (!trim(title)) errors.title = TITLE_REQUIRED_MESSAGE;
  const { valid, error } = collectLines(lines);
  if (error) {
    errors.lines = error;
    return errors;
  }
  // numbers: a root line's quantity and rate are non-negative numbers; a sub-task's percentage is a number
  for (const [i, l] of valid.entries()) {
    const sub = Boolean(trim(l.parentItemCode));
    const fields: [string, string | undefined][] = sub ? [["Breakdown %", l.breakdownPercentage]] : [["Qty", l.quantity], ["Rate", l.rate]];
    for (const [label, raw] of fields) {
      const n = Number(trim(raw));
      if (!Number.isFinite(n) || n < 0) return { ...errors, lines: `Line ${i + 1}: ${label} must be a number, zero or more. Nothing was saved.` };
    }
  }
  const codes = new Set<string>();
  for (const [i, l] of valid.entries()) {
    const code = trim(l.itemCode);
    if (!code) continue;
    if (codes.has(code)) return { ...errors, lines: `Line ${i + 1}: item code "${code}" is used twice -- item codes must be unique within one BOQ. Nothing was saved.` };
    codes.add(code);
  }
  for (const [i, l] of valid.entries()) {
    const parent = trim(l.parentItemCode);
    if (!parent) continue;
    if (!codes.has(parent)) return { ...errors, lines: `Line ${i + 1}: parent code "${parent}" does not match any item code in this BOQ. Nothing was saved.` };
  }
  for (const [i, l] of valid.entries()) {
    if (trim(l.parentItemCode) && draftRootAncestor(l, valid) === null) {
      return { ...errors, lines: `Line ${i + 1}: the parent codes go round in a circle. Nothing was saved.` };
    }
  }
  return errors;
}

/** The sum of EVERY line's amount (sub-tasks included): the figure whose change against the previous revision is the variation. */
export function allLinesTotal(lines: LineItemDraft[]): number {
  return lines.reduce((sum, l) => sum + (draftLineAmount(l, lines) ?? 0), 0);
}

export type Variation = { previousAll: number; newAll: number; variation: number; previousTotal: number; newTotal: number };

/** What the revision changes in money, against the revision it is made from. */
export function revisionVariation(parent: readonly BoqLineItemRow[], lines: LineItemDraft[]): Variation {
  const previousAll = parent.reduce((s, r) => s + Number(r.amount), 0);
  const previousTotal = parent.filter((r) => !r.parentLineItemId).reduce((s, r) => s + Number(r.amount), 0);
  const kept = lines.filter((l) => !isBlank(l));
  const newAll = allLinesTotal(kept);
  return { previousAll, newAll, variation: newAll - previousAll, previousTotal, newTotal: draftBoqTotal(kept) };
}

const isBlank = (l: LineItemDraft) => !trim(l.description) && !trim(l.itemCode) && !trim(l.quantity) && !trim(l.rate);
/** The server's diff key: the item code, else the description (construction-boq-service.ts lineItemKey). */
const keyOfRow = (r: BoqLineItemRow) => r.itemCode || r.description;
const keyOfDraft = (l: LineItemDraft) => trim(l.itemCode) || trim(l.description);
/**
 * A line saved with no item code reaches the revise form under an invented one, `_row_<id>` (boq-helpers toDrafts, with a `_x` de-dup suffix
 * if that name is taken). It still IS the old line, so it must not read as a removal: the server's diffLineItems resolves it the same way.
 */
const inventedCodeNames = (code: string, rowId: string) => code === `_row_${rowId}` || code.startsWith(`_row_${rowId}_`);

/**
 * The lines of the revision this person may not make: a line with progress recorded on site that the revision removes, or whose amount it
 * reduces. `progress` maps a parent line id to the percent complete of its latest entry. Same rule as findScopeReductionViolations.
 */
export function scopeReductions(parent: readonly BoqLineItemRow[], progress: ReadonlyMap<string, number>, lines: LineItemDraft[]): string[] {
  const kept = lines.filter((l) => !isBlank(l));
  const draftByKey = new Map(kept.map((l) => [keyOfDraft(l), l]));
  const out: string[] = [];
  for (const row of parent) {
    const pct = progress.get(row.id);
    if (!pct || pct <= 0) continue;
    const next = draftByKey.get(keyOfRow(row)) ?? (row.itemCode ? undefined : kept.find((l) => inventedCodeNames(trim(l.itemCode), row.id)));
    if (!next) {
      out.push(`"${row.description}" is ${pct}% complete on site and would be removed entirely`);
      continue;
    }
    const amount = draftLineAmount(next, kept);
    if (amount !== null && amount - Number(row.amount) < 0) out.push(`"${row.description}" is ${pct}% complete on site and this revision reduces it`);
  }
  return out;
}

/** The latest percent complete per BOQ line from this laptop's progress entries (the entry with the latest date wins). */
export function latestProgress(entries: readonly { boqLineItemId: string | null; entryDate: string; percentComplete: number | null; createdAt: string | null }[]): Map<string, number> {
  const best = new Map<string, { at: string; pct: number }>();
  for (const e of entries) {
    if (!e.boqLineItemId || e.percentComplete === null) continue;
    const at = `${e.entryDate}|${e.createdAt ?? ""}`;
    const cur = best.get(e.boqLineItemId);
    if (!cur || at > cur.at) best.set(e.boqLineItemId, { at, pct: e.percentComplete });
  }
  return new Map([...best].map(([id, v]) => [id, v.pct]));
}

/** The lines as the optimistic `boqs` row keeps them (the server's snake_case column names, amounts as the laptop computed them for display). */
function localLines(tempId: string, lines: LineItemDraft[]) {
  return lines.map((l, i) => ({
    id: `${tempId}:${i}`, item_code: trim(l.itemCode) || null, description: trim(l.description), unit: trim(l.unit), quantity: Number(trim(l.quantity)) || 0,
    rate: Number(trim(l.rate)) || 0, amount: draftLineAmount(l, lines) ?? 0, category: trim(l.category) || null,
    parent_item_code: trim(l.parentItemCode) || null, breakdown_percentage: trim(l.breakdownPercentage) ? Number(trim(l.breakdownPercentage)) : null,
  }));
}

export type NewBoq = { projectId: string; title: string; lines: LineItemDraft[] };

export async function createBoqOffline(input: NewBoq, access: DesignChangeWriteAccess): Promise<ScopeWriteResult> {
  if (Object.keys(validateBoqDraft(input.title, input.lines)).length > 0) return { queued: false, reason: "invalid" };
  try {
    const ctx = await ready(input.projectId, access);
    if (!ctx) return { queued: false, reason: "no_copy" };
    const tempId = tempIdOf();
    const { valid } = collectLines(input.lines);
    const title = input.title.trim();
    const { opId } = await ctx.outbox.enqueue({
      functionId: "create_boq",
      projectId: input.projectId,
      // the retry key is the temporary id, made once now: a send that is repeated after an unanswered attempt is ONE BOQ
      params: { projectId: input.projectId, title, lineItems: toPayloadLineItems(valid), idempotency_key: tempId },
      label: "New BOQ",
      creates: { kind: BOQS_KIND, id: tempId },
      optimistic: async (tx) => {
        await tx.putRecord({
          id: `${BOQS_KIND}:${tempId}`, type: BOQS_KIND, orgId: ctx.orgId, projectId: input.projectId,
          // status is the server's to assign: none is invented here (a header with no status is never read as a synced BOQ)
          data: { id: tempId, project_id: input.projectId, title, version: 1, status: null, parent_boq_id: null, created_at: null, local_lines: localLines(tempId, valid) },
        });
      },
    });
    return { queued: true, opId, tempId };
  } catch (error) {
    if (error instanceof OutboxRefusal && error.code === "TOO_LARGE") return { queued: false, reason: "too_large" };
    return { queued: false, reason: "failed" };
  }
}

/** An APPROVED change order of the project that no BOQ revision has been made from yet: the only kind the server lets a revision be linked to. */
export type LinkableChangeOrder = { id: string; number: number | null; title: string };

export type NewRevision = {
  projectId: string;
  /** The server's BOQ this revision is made from: a row the laptop holds at a server version, never a temporary one. */
  parentBoqId: string;
  parent: readonly BoqLineItemRow[];
  parentVersion: number;
  title: string;
  lines: LineItemDraft[];
  /** The latest percent complete per parent line id, from this laptop's progress entries. */
  progress: ReadonlyMap<string, number>;
  /**
   * CHANGE OF SCOPE (R-98): the approved change order this revision carries out. The server links the two (the change order's boq_revision_id) in
   * the same transaction as the revision, and refuses a change order that is not approved, is already linked, or is another project's. The
   * laptop checks the first two from its own copy against `linkable` (the approved, unlinked change orders it holds) and sends the id.
   */
  sourceChangeOrderId?: string;
  linkable?: readonly LinkableChangeOrder[];
};

export function validateRevision(input: Pick<NewRevision, "title" | "lines" | "parent" | "progress">): BoqDraftErrors & { reductions?: string[] } {
  const errors: BoqDraftErrors & { reductions?: string[] } = validateBoqDraft(input.title, input.lines);
  if (errors.lines) return errors;
  const reductions = scopeReductions(input.parent, input.progress, input.lines);
  if (reductions.length > 0) errors.reductions = reductions;
  return errors;
}

export async function reviseBoqOffline(input: NewRevision, access: DesignChangeWriteAccess): Promise<ScopeWriteResult> {
  const errors = validateRevision(input);
  if (errors.title || errors.lines) return { queued: false, reason: "invalid" };
  if (errors.reductions) return { queued: false, reason: "blocked" };
  if (input.parentBoqId.startsWith("local-")) return { queued: false, reason: "no_row" };
  // CHANGE OF SCOPE: only an approved change order that no revision was made from yet (the server's rules, from this laptop's copy)
  if (input.sourceChangeOrderId !== undefined && !(input.linkable ?? []).some((c) => c.id === input.sourceChangeOrderId)) return { queued: false, reason: "change_order" };
  try {
    const ctx = await ready(input.projectId, access);
    if (!ctx) return { queued: false, reason: "no_copy" };
    // A BOQ can be revised once: the server refuses a second revision of the same parent (409). Two revisions made one after the other with no
    // network would both be built on the same parent, so the second is refused HERE, in words, instead of coming back as a rejected card.
    if (await revisionAlreadyWaiting(ctx.idb, ctx.userId, input.parentBoqId)) return { queued: false, reason: "revision_waiting" };
    const tempId = tempIdOf();
    const { valid } = collectLines(input.lines);
    const title = input.title.trim();
    const { opId } = await ctx.outbox.enqueue({
      functionId: "create_boq_revision",
      projectId: input.projectId,
      // no allowScopeReductionOverride: the override is made online, with the blocked lines in front of the person
      params: {
        projectId: input.projectId, boqId: input.parentBoqId, title, lineItems: toPayloadLineItems(valid),
        ...(input.sourceChangeOrderId !== undefined ? { sourceChangeOrderId: input.sourceChangeOrderId } : {}),
      },
      label: input.sourceChangeOrderId !== undefined ? "New BOQ revision (change of scope)" : "New BOQ revision",
      creates: { kind: BOQS_KIND, id: tempId },
      optimistic: async (tx) => {
        await tx.putRecord({
          id: `${BOQS_KIND}:${tempId}`, type: BOQS_KIND, orgId: ctx.orgId, projectId: input.projectId,
          data: { id: tempId, project_id: input.projectId, title, version: input.parentVersion + 1, status: null, parent_boq_id: input.parentBoqId, created_at: null, local_lines: localLines(tempId, valid) },
        });
      },
    });
    return { queued: true, opId, tempId };
  } catch (error) {
    if (error instanceof OutboxRefusal && error.code === "TOO_LARGE") return { queued: false, reason: "too_large" };
    return { queued: false, reason: "failed" };
  }
}

/**
 * ADD A SCOPE ITEM (R-96): one or more new lines on a BOQ that already exists. Online this is a revision that keeps every line and adds the new
 * ones, so that is what is kept here: ONE create_boq_revision with the parent's lines plus the new items. Nothing existing is touched, so the
 * progress guard has nothing to refuse unless the person's own edits to the kept lines would do so (they are not offered on this screen).
 * Everything reviseBoqOffline checks applies (an item code used twice, a missing field, a revision already waiting, a change order that cannot be used).
 */
export type NewScopeItems = Omit<NewRevision, "lines" | "title"> & {
  items: LineItemDraft[];
  /** The BOQ's own title, used for the revision when none is given. */
  boqTitle: string;
  title?: string;
};

export async function addScopeItemsOffline(input: NewScopeItems, access: DesignChangeWriteAccess): Promise<ScopeWriteResult> {
  const items = input.items.filter((l) => !isBlank(l));
  if (items.length === 0) return { queued: false, reason: "invalid" };
  const { items: _items, boqTitle, title, ...rest } = input;
  return reviseBoqOffline({ ...rest, title: trim(title) || boqTitle, lines: [...toDrafts([...input.parent]), ...items] }, access);
}

/** Whether this person's outbox already holds a revision of this BOQ (any status: a refused or conflicted one is still in the outbox). */
export async function revisionAlreadyWaiting(idb: IDBFactory, userId: string, parentBoqId: string): Promise<boolean> {
  const db = await openLocalDb(idb, localDbNameFor(userId));
  try {
    return (await db.listOps()).some((op) => op.functionId === "create_boq_revision" && op.params.boqId === parentBoqId);
  } finally {
    db.close();
  }
}

/** Plain words for a BOQ write that was not kept on the laptop. */
export function scopeNotQueuedMessage(reason: Exclude<ScopeWriteResult, { queued: true }>["reason"]): string {
  switch (reason) {
    case "no_copy":
      return "This project is not copied to this laptop yet, so this cannot be saved here. Please try again when you are online.";
    case "no_row":
      return "This laptop does not hold the server's copy of this BOQ yet, so a revision cannot be saved here. Please try again when you are online.";
    case "invalid":
      return "Please check the highlighted fields.";
    case "blocked":
      return "A revision cannot remove or reduce a line that already has work recorded on site. Nothing was saved.";
    case "revision_waiting":
      return "A revision of this BOQ is already waiting to be sent, and a BOQ can be revised only once. Nothing was saved. Wait until it has been sent, then make the next change from the new revision.";
    case "change_order":
      return "That change order cannot be used: only an approved change order that no BOQ revision has been made from yet can be linked. Nothing was saved.";
    case "too_large":
      return "This BOQ is too large to send in one go from the laptop. Nothing was saved here; create it while you are online (or import it from Excel).";
    default:
      return "This could not be saved on this laptop. Please try again.";
  }
}

// ─── the budget overlay of a BOQ line (R-C09) ──────────────────────────────────────────────────────────────────────────────────────────

/** The default budget percent of a line the server has never been told a budget for (the column's own default). */
export const DEFAULT_BUDGET_PERCENT = "25";

export type BudgetCurrent = { budgetPercentage: string | null; vendorId: string | null; vendorAmount: string | null };
export type BudgetEdit = {
  projectId: string;
  lineId: string;
  /** What the line holds now (the laptop's copy). */
  current: BudgetCurrent;
  /** As typed. Empty = leave this field alone. */
  budgetPercentage: string;
  vendorId: string;
  vendorAmount: string;
};
export type BudgetErrors = { budgetPercentage?: string; vendorAmount?: string; nothing?: string };

/** The line's budget: amount x percent / 100 (derived, never stored; the server's computedBudget). */
export const computedBudget = (amount: number, percent: number): number => (amount * percent) / 100;

/**
 * The server's rules for the three fields, in plain words: the percent is a number from 0 to 100 (both allowed), the vendor amount a number of zero
 * or more. Only what the person CHANGED is sent, so a call that changes nothing is refused here as it is on the server (VALUE_REQUIRED).
 */
export function validateBudgetEdit(input: BudgetEdit): BudgetErrors {
  const errors: BudgetErrors = {};
  const pct = trim(input.budgetPercentage);
  if (pct) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.budgetPercentage = "Budget % must be a number from 0 to 100.";
  }
  const amount = trim(input.vendorAmount);
  if (amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) errors.vendorAmount = "Vendor amount must be a number, zero or more.";
  }
  if (!errors.budgetPercentage && !errors.vendorAmount && Object.keys(budgetPatch(input)).length === 0) errors.nothing = "Nothing was changed.";
  return errors;
}

/** The parameters of the fields that differ from what the line holds. */
export function budgetPatch(input: BudgetEdit): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pct = trim(input.budgetPercentage);
  if (pct && Number(pct) !== Number(input.current.budgetPercentage ?? DEFAULT_BUDGET_PERCENT)) out.budgetPercentage = Number(pct);
  const vendor = trim(input.vendorId);
  if (vendor && vendor !== (input.current.vendorId ?? "")) out.vendorId = vendor;
  const amount = trim(input.vendorAmount);
  if (amount && (input.current.vendorAmount === null || Number(amount) !== Number(input.current.vendorAmount))) out.vendorAmount = Number(amount);
  return out;
}

export type BudgetWriteResult = { queued: true; opId: string } | { queued: false; reason: "no_copy" | "no_row" | "invalid" | "failed" };

/**
 * Sets a line's budget percent, vendor and vendor amount: ONE update_line_item_budget op on the line, based on the server version this laptop holds
 * (a change made on the server meanwhile comes back as a conflict card, never a silent overwrite). Changes nothing on the laptop: the line keeps
 * what the server last said and the screen marks it "Waiting to sync". Manager rank (the registry's min_role_rank 3): decided again by the server.
 */
export async function setLineBudgetOffline(input: BudgetEdit, access: DesignChangeWriteAccess): Promise<BudgetWriteResult> {
  if (Object.keys(validateBudgetEdit(input)).length > 0) return { queued: false, reason: "invalid" };
  try {
    const ctx = await ready(input.projectId, access);
    if (!ctx) return { queued: false, reason: "no_copy" };
    const row = await editableRow(ctx, BOQ_LINES_KIND, input.lineId, input.projectId);
    if (!row) return { queued: false, reason: "no_row" };
    const { opId } = await ctx.outbox.enqueue({
      functionId: "update_line_item_budget",
      projectId: input.projectId,
      params: { projectId: input.projectId, boqLineItemId: input.lineId, ...budgetPatch(input) },
      label: "Line budget",
      record: { kind: BOQ_LINES_KIND, id: input.lineId, baseVersion: row.serverVersion },
    });
    return { queued: true, opId };
  } catch {
    return { queued: false, reason: "failed" };
  }
}
