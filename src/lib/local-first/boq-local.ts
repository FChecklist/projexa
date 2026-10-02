// LOCAL-FIRST slice 2, the one proof screen: the BOQ Object Page's line items, read from the laptop's own
// copy first. Everything here is behind the localStorage flag `px-local-first` = "1" (local-reader.ts); with
// the flag off every function returns null and the screen behaves exactly as it did before.
//
// HOW IT FITS THE EXISTING SCREEN
//   * The screen is opened by BOQ id; the replica is organised by project id. The first time a BOQ is opened
//     the screen loads the usual way (server) and remembers that BOQ's header and project on this laptop
//     (rememberBoq). Later visits find the project, ask the replica for its `boq_lines`, and keep this BOQ's own
//     lines (the replica holds the project's lines of every BOQ and revision, like the gateway's pages).
//   * Reading goes through loadLocalFirst (the same core useLocalFirst uses): the replica's rows when that
//     (project, kind) was synced to the end, otherwise null so the screen's existing loader runs.
//   * After either path the screen asks the replica to pull changes in the background (revalidateBoq).
//
// WHAT STAYS ON THE SERVER, ON PURPOSE (owner safeguard: browser data is a cache and a proposal, never authority)
//   writes (PATCH /api/scope/line-items/...), submit/approve, the money grid (BoqDualViewGrid reads the cost columns
//   through the proxy), and every figure that decides money. Local rows are for reading and display.

import type { Boq } from "@/lib/boq-helpers";
import type { GatewayBoqLine } from "@/lib/boq-gateway-client";
import { orderLinesForBoq, toBoqLineItemRow, type BoqScreenLoad } from "@/lib/boq-read-source";
import { isLocalFirstEnabled, loadLocalFirst, type LocalAccess } from "./local-reader";

/** The kind name the sync service uses for BOQ line items. */
export const BOQ_LINES_KIND = "boq_lines";
/** The kind name the sync service uses for BOQ headers (title, version, status). */
export const BOQS_KIND = "boqs";

const hintKey = (boqId: string) => `px-local-first-boq:${boqId}`;

function isBoqHeader(v: unknown): v is Boq {
  return typeof v === "object" && v !== null && typeof (v as Boq).id === "string" && typeof (v as Boq).projectId === "string";
}

/** The replica's rows are untrusted input until they look like a line of a BOQ: anything else is skipped. */
export function isGatewayLine(v: unknown): v is GatewayBoqLine {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.boqId === "string" && typeof o.description === "string"
    && typeof o.unit === "string" && typeof o.quantity === "string" && typeof o.rate === "string" && typeof o.amount === "string";
}

// ─── the REAL wire shape (review F09) ───────────────────────────────────────────────────────────────────
// The sync service does NOT send the BOQ gateway's shape. A `boq_lines` row is the AI work link's record: raw snake_case column names,
// money and quantities as JSON numbers, and no BOQ title/version/status (those are the `boqs` kind):
//   boq_lines: {id, boq_id, item_code, description, unit, quantity: 120.5, rate: 450, amount: 54225, parent_line_item_id, activity_id,
//               category, qty_contract, rate_contract, rate_project, material_cost, labour_cost, equipment_cost, overhead_percent,
//               profit_percent, breakdown_percentage, budget_percentage, vendor_id, vendor_amount, material_amount, manpower_amount, created_at}
//   boqs:      {id, project_id, title, version, status, parent_boq_id, created_at, updated_at, approved_at, approved_by_id, ...}
// (observed through the real handler: src/lib/local-first/conformance/wire.integration.test.ts W18/W18b). These mappers turn them into
// the screen's own shapes, and still accept the gateway shape (a row an older path stored). Nothing is invented: a line whose quantity,
// rate or amount is absent or null (money hidden from this role) is not drawn, rather than drawn as zero.

/** What a line needs from its BOQ's header. */
export type BoqFacts = { title: string; version: number; status: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A number (JSON number or numeric string) as the decimal string the screen's shape carries; null when absent or not a number. */
function decimal(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return v.trim();
  return null;
}
const optText = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A `boqs` row (sync shape) or a remembered header (screen shape) as the screen's Boq; null when it is not one. Pure. */
export function toBoqHeader(v: unknown, projectId?: string): Boq | null {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.title !== "string" || typeof v.status !== "string") return null;
  const version = typeof v.version === "number" ? v.version : Number(v.version);
  if (!Number.isInteger(version)) return null;
  const project = typeof v.projectId === "string" ? v.projectId : typeof v.project_id === "string" ? v.project_id : projectId;
  if (!project) return null;
  return {
    id: v.id, projectId: project, version, title: v.title, status: v.status,
    parentBoqId: optText(v.parentBoqId) ?? optText(v.parent_boq_id),
    createdAt: optText(v.createdAt) ?? optText(v.created_at) ?? "",
  };
}

/**
 * One replica row of `boq_lines` as the screen's line; null when it is not a drawable BOQ line. The sync shape needs its BOQ's header
 * facts (`facts`, from the `boqs` kind or the remembered header); without them it is not drawn. Pure.
 */
export function toGatewayLine(v: unknown, facts?: BoqFacts | null): GatewayBoqLine | null {
  if (isGatewayLine(v)) return v; // already the screen's shape
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.boq_id !== "string" || typeof v.description !== "string" || typeof v.unit !== "string") return null;
  const quantity = decimal(v.quantity);
  const rate = decimal(v.rate);
  const amount = decimal(v.amount);
  if (quantity === null || rate === null || amount === null) return null;
  if (!facts) return null;
  return {
    id: v.id, boqId: v.boq_id, boqTitle: facts.title, boqVersion: facts.version, boqStatus: facts.status,
    parentLineItemId: optText(v.parent_line_item_id), activityId: optText(v.activity_id), itemCode: optText(v.item_code), category: optText(v.category),
    description: v.description, unit: v.unit, quantity, rate, amount,
    qtyContract: decimal(v.qty_contract), rateContract: decimal(v.rate_contract),
    materialCost: decimal(v.material_cost), labourCost: decimal(v.labour_cost), equipmentCost: decimal(v.equipment_cost),
    overheadPercent: decimal(v.overhead_percent), profitPercent: decimal(v.profit_percent),
    breakdownPercentage: decimal(v.breakdown_percentage), budgetPercentage: decimal(v.budget_percentage),
    vendorId: optText(v.vendor_id), vendorAmount: decimal(v.vendor_amount), materialAmount: decimal(v.material_amount), manpowerAmount: decimal(v.manpower_amount),
    createdAt: optText(v.created_at),
  };
}

/** The BOQ a replica line belongs to (either shape), or null. */
export function lineBoqId(v: unknown): string | null {
  if (!isRecord(v)) return null;
  return typeof v.boqId === "string" ? v.boqId : typeof v.boq_id === "string" ? v.boq_id : null;
}

/**
 * A project's replica rows of `boq_lines` and `boqs` as screen lines: each line takes its BOQ's facts from the `boqs` row (or from
 * `fallback` for a BOQ whose header row is not on the laptop). Untrusted rows that do not map are skipped. Pure.
 */
export function linesFromReplica(lineRows: readonly unknown[], headerRows: readonly unknown[], fallback?: (boqId: string) => BoqFacts | null): GatewayBoqLine[] {
  const facts = new Map<string, BoqFacts>();
  for (const row of headerRows) {
    const h = toBoqHeader(row, "?");
    if (h) facts.set(h.id, { title: h.title, version: h.version, status: h.status });
  }
  const out: GatewayBoqLine[] = [];
  for (const row of lineRows) {
    const boqId = lineBoqId(row);
    if (!boqId) continue;
    const line = toGatewayLine(row, facts.get(boqId) ?? fallback?.(boqId) ?? null);
    if (line) out.push(line);
  }
  return out;
}

/** Remembers a BOQ's header on this laptop so the next visit can find its project. No-op with the flag off. */
export function rememberBoq(boq: Boq): void {
  if (!isLocalFirstEnabled()) return;
  try {
    localStorage.setItem(hintKey(boq.id), JSON.stringify(boq));
  } catch {
    /* storage full or blocked: the next visit simply loads from the server again */
  }
}

function readHint(boqId: string): Boq | null {
  try {
    const raw = localStorage.getItem(hintKey(boqId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isBoqHeader(parsed) && parsed.id === boqId ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The BOQ as the screen takes it, built from the laptop's copy; null whenever the copy cannot answer (flag off, BOQ never opened here,
 * project not synced to the end, no lines of this BOQ in it, any read failure), in which case the caller loads the usual way.
 */
export async function loadBoqFromReplica(boqId: string, access: LocalAccess = {}): Promise<BoqScreenLoad | null> {
  if (!isLocalFirstEnabled()) return null;
  const header = readHint(boqId);
  if (!header) return null;
  try {
    const result = await loadLocalFirst<unknown>(BOQ_LINES_KIND, header.projectId, async () => [], access);
    if (result.state !== "local") return null;
    // The BOQ's own row (the `boqs` kind) carries its current title/version/status; when it is not on the laptop, the header this
    // screen remembered from its last online visit does.
    const headers = await loadLocalFirst<unknown>(BOQS_KIND, header.projectId, async () => [], access);
    const headerRows = headers.state === "local" ? headers.rows : [];
    const remembered: BoqFacts = { title: header.title, version: header.version, status: header.status };
    const mine = linesFromReplica(result.rows.filter((r) => lineBoqId(r) === boqId), headerRows, (id) => (id === boqId ? remembered : null));
    if (mine.length === 0) return null;
    const first = mine[0]!;
    // Title, version and status are the fields a person changes: taken from the synced rows. Lineage (parent, created) never changes.
    const boq: Boq = { ...header, title: first.boqTitle, version: first.boqVersion, status: first.boqStatus };
    return {
      boq,
      lines: orderLinesForBoq(mine).map(toBoqLineItemRow),
      source: "local-replica",
      copySavedAt: new Date(result.syncedAt ?? Date.now()).toISOString(),
      copyStatus: "off",
      indexedLines: 0,
    };
  } catch {
    return null;
  }
}

/** Pulls changes for this BOQ's project into the laptop's copy, in the background. Never throws, does nothing with the flag off. */
export async function revalidateBoq(
  boq: Pick<Boq, "projectId">,
  revalidate?: (ctx: { kind: string; projectId: string; userId: string }) => Promise<void>,
  userId?: string | null
): Promise<void> {
  if (!isLocalFirstEnabled()) return;
  try {
    let id = userId ?? null;
    if (!id) {
      const { createClient } = await import("@/lib/supabase/client");
      id = (await createClient().auth.getUser()).data.user?.id ?? null;
    }
    if (!id) return;
    const run = revalidate ?? (await import("./replica-shared")).revalidateViaSharedReplica;
    await run({ kind: BOQ_LINES_KIND, projectId: boq.projectId, userId: id });
  } catch {
    /* best effort */
  }
}
