// LOCAL-FIRST shell, Materials, read from the laptop's own database.
//
// THE ONLINE SCREENS (src/app/(app)/materials): /materials with ?tab=master (Name, Spec, Unit, Unit Cost, Received to date, On hand),
// ?tab=receipts (Date, Material, Vendor, Reference, Quantity, Unit Cost, Line total), ?tab=issues (Date, Material, Issued to, BOQ item,
// Quantity), ?tab=cost-report (the server's aggregation); /materials/:id; /materials/receipts/new; /materials/receipts/:id;
// /materials/issues/new; /materials/new.
//
// WHAT THE LAPTOP HAS. Kinds `materials` (id, name, spec, unit, reorder_level, is_active, unit_cost), `material_receipts` (id,
// material_id, received_date, quantity, reference, notes, voided_at, void_reason, unit_cost, vendor_id) and `material_issues` (id,
// material_id, issued_date, quantity, boq_line_item_id, issued_to, note). unit_cost and vendor_id are hidden below the role that may
// see cost.
//
// STOCK. Online, "on hand" is the server's (VERIDIAN listMaterials: received minus issued, voided receipts left out). On the laptop
// it is counted the SAME way from the laptop's own copy, including what the person recorded here and has not sent yet -- quantities,
// not money -- and the screen says it is the laptop's count. It is null (shown "-") unless BOTH receipts and issues are on the laptop:
// half a ledger is not a stock figure. Money (line totals, cost report) is never computed here.
//
// GAPS: vendor names (organisation kind not consumed by the client engine yet); "recorded by" on a receipt (not in the projection).

import type { ShellData } from "../context";
import {
  DELIVERY_KINDS, parseBoqLineRef, parseIssue, parseMaterial, parseReceipt, readKind,
  type BoqLineRef, type Issue, type Material, type Receipt,
} from "./delivery-local";

export const isTempId = (id: string): boolean => id.startsWith("local-");

export type MaterialRow = Material & { receivedToDate: number | null; issuedToDate: number | null; onHand: number | null; low: boolean };
export type ReceiptRow = Receipt & { materialName: string | null; unit: string | null; waiting: boolean };
export type IssueRow = Issue & { materialName: string | null; unit: string | null; boqLabel: string | null; waiting: boolean };

export type MaterialsData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | {
      state: "local";
      projectId: string;
      materials: MaterialRow[];
      receipts: ReceiptRow[] | null;
      issues: IssueRow[] | null;
      /** Every BOQ line of the project on the laptop (for the issue form), or null when they are not here. */
      lines: BoqLineRef[] | null;
      costHidden: boolean;
      syncedAt: number;
    };

export type MaterialData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; material: MaterialRow; receipts: ReceiptRow[] | null; issues: IssueRow[] | null; costHidden: boolean; syncedAt: number };

export type ReceiptData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; receipt: ReceiptRow; costHidden: boolean; syncedAt: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

async function readMaterials(data: ShellData, projectId: string) {
  const [materials, receipts, issues, lines] = await Promise.all([
    readKind(data, projectId, DELIVERY_KINDS.materials, parseMaterial),
    readKind(data, projectId, DELIVERY_KINDS.receipts, parseReceipt),
    readKind(data, projectId, DELIVERY_KINDS.issues, parseIssue),
    readKind(data, projectId, DELIVERY_KINDS.boqLines, parseBoqLineRef),
  ]);
  if (!materials.synced) return null;
  const costHidden = materials.hidden.includes("unit_cost") || (receipts.synced && receipts.hidden.includes("unit_cost"));
  const byId = new Map(materials.rows.map((m) => [m.id, m]));
  const lineById = new Map((lines.synced ? lines.rows : []).map((l) => [l.id, l]));

  const receiptRows: ReceiptRow[] | null = receipts.synced
    ? receipts.rows
        .map((r) => ({
          ...r,
          unitCost: costHidden ? null : r.unitCost,
          materialName: byId.get(r.materialId)?.name ?? null,
          unit: byId.get(r.materialId)?.unit ?? null,
          waiting: isTempId(r.id),
        }))
        .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || a.id.localeCompare(b.id))
    : null;
  const issueRows: IssueRow[] | null = issues.synced
    ? issues.rows
        .map((i) => {
          const l = i.boqLineItemId ? lineById.get(i.boqLineItemId) : undefined;
          return {
            ...i, materialName: byId.get(i.materialId)?.name ?? null, unit: byId.get(i.materialId)?.unit ?? null,
            boqLabel: l ? (l.itemCode ? `${l.itemCode} · ${l.description}` : l.description) : null, waiting: isTempId(i.id),
          };
        })
        .sort((a, b) => b.issuedDate.localeCompare(a.issuedDate) || a.id.localeCompare(b.id))
    : null;

  const materialRows: MaterialRow[] = materials.rows
    .map((m) => {
      const received = receiptRows ? round(receiptRows.filter((r) => r.materialId === m.id && !r.voided).reduce((s, r) => s + r.quantity, 0)) : null;
      const issued = issueRows ? round(issueRows.filter((i) => i.materialId === m.id).reduce((s, i) => s + i.quantity, 0)) : null;
      const onHand = received !== null && issued !== null ? round(received - issued) : null;
      return {
        ...m, unitCost: costHidden ? null : m.unitCost, receivedToDate: received, issuedToDate: issued, onHand,
        low: onHand !== null && m.reorderLevel !== null && onHand < m.reorderLevel,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { materialRows, receiptRows, issueRows, lines: lines.synced ? lines.rows : null, costHidden, syncedAt: materials.syncedAt };
}

export async function loadMaterials(data: ShellData, projectId: string | null): Promise<MaterialsData> {
  if (!projectId) return { state: "no_project" };
  const read = await readMaterials(data, projectId);
  if (!read) return { state: "not_synced", projectId };
  return {
    state: "local", projectId, materials: read.materialRows, receipts: read.receiptRows, issues: read.issueRows, lines: read.lines,
    costHidden: read.costHidden, syncedAt: read.syncedAt,
  };
}

async function findIn<T>(
  data: ShellData,
  projectId: string | null,
  pick: (read: NonNullable<Awaited<ReturnType<typeof readMaterials>>>, projectId: string) => T | null
): Promise<{ state: "no_project" } | { state: "not_synced"; projectId: string | null } | { state: "not_found"; projectId: string | null } | { state: "found"; value: T }> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const read = await readMaterials(data, candidate);
    if (!read) continue;
    anySynced = true;
    const value = pick(read, candidate);
    if (value !== null) return { state: "found", value };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

export async function loadMaterial(data: ShellData, materialId: string, projectId: string | null): Promise<MaterialData> {
  const r = await findIn(data, projectId, (read, p) => {
    const material = read.materialRows.find((m) => m.id === materialId);
    if (!material) return null;
    return {
      state: "local" as const, projectId: p, material,
      receipts: read.receiptRows ? read.receiptRows.filter((x) => x.materialId === materialId) : null,
      issues: read.issueRows ? read.issueRows.filter((x) => x.materialId === materialId) : null,
      costHidden: read.costHidden, syncedAt: read.syncedAt,
    };
  });
  return r.state === "found" ? r.value : r;
}

export async function loadReceipt(data: ShellData, receiptId: string, projectId: string | null): Promise<ReceiptData> {
  const r = await findIn(data, projectId, (read, p) => {
    const receipt = read.receiptRows?.find((x) => x.id === receiptId);
    return receipt ? { state: "local" as const, projectId: p, receipt, costHidden: read.costHidden, syncedAt: read.syncedAt } : null;
  });
  return r.state === "found" ? r.value : r;
}
