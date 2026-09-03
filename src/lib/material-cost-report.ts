// R67 F-07 (R-100/R-106). The Cost Report tab used to cost a THIRD hot-path
// request: /materials fetched the master, the receipts AND
// /api/construction-materials/cost-report on mount, all behind one flag, for a
// two-row table. But the cost report is a pure roll-up of the receipts the
// screen has already loaded -- there is nothing in it the browser does not
// already hold.
//
// So the on-screen tab derives it here, and the server endpoint stays for the
// exportable report (C03-14), which needs to run without a loaded page.
//
// *** THE ARITHMETIC MATCHES construction-materials-service.ts#getMaterialCostReport
// EXACTLY, AND THAT IS THE POINT. *** Two screens showing different totals
// under the same label is the defect class this programme is removing, so this
// is a re-expression of that SQL, not a second opinion:
//
//   totalQuantityReceived = sum(quantity)                 -- every receipt
//   totalCost             = sum(quantity * unitCost)      -- SQL sum() skips
//                                                            NULLs, so a
//                                                            receipt with no
//                                                            stated unit cost
//                                                            adds quantity but
//                                                            no cost
//   averageUnitCost       = totalCost / totalQuantityReceived, 0 when there is
//                           no quantity
//   both money figures rounded to 2 dp, the same way and at the same step
//   only materials that actually have receipts appear (the SQL GROUP BY)
//
// NOTE ON THE ITEM'S OWN WORDING. R67 F-07 describes the cost as
// "quantity x (unitCost ?? master.unitCost)". That fallback is deliberately
// NOT implemented: the server-side report -- the one a user exports and sends
// on -- does not do it, so adopting it here would make the number on screen
// disagree with the number in the export for any receipt booked without a
// price. If the fallback is the behaviour the business wants, it belongs in
// getMaterialCostReport() first, and both sides move together.
//
// The one deliberate difference is ordering: the SQL has no ORDER BY, so its
// row order is whatever Postgres returns. This sorts by material name, which
// is stable and readable, and changes no value.

export type CostReportMaterial = { id: string; name: string; spec: string | null; unit: string };
export type CostReportReceipt = { materialId: string; quantity: string | number; unitCost: string | number | null };

export type CostReportRow = {
  materialId: string;
  name: string;
  spec: string | null;
  unit: string;
  totalQuantityReceived: number;
  totalCost: number;
  averageUnitCost: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildMaterialCostReport(
  materials: CostReportMaterial[],
  receipts: CostReportReceipt[]
): CostReportRow[] {
  if (receipts.length === 0) return [];

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const totals = new Map<string, { quantity: number; cost: number }>();

  for (const receipt of receipts) {
    const quantity = toNumber(receipt.quantity) ?? 0;
    const unitCost = toNumber(receipt.unitCost);
    const running = totals.get(receipt.materialId) ?? { quantity: 0, cost: 0 };
    running.quantity += quantity;
    // NULL unit cost contributes no cost -- exactly what SQL's
    // sum(quantity * unitCost) does with a NULL factor.
    //
    // A DELIBERATE DEVIATION FROM THE R67 F-07 ITEM, recorded here rather than
    // only in a PR body. F-07 specifies the derived cost as
    // `quantity x (unitCost ?? master.unitCost)`. That fallback is NOT applied,
    // because compliance-tracker's getMaterialCostReport() -- the aggregation
    // behind the EXPORTABLE report, construction-materials-service.ts:107 --
    // does a plain `sum(quantity * unit_cost)` with no fallback. Adopting the
    // fallback on the screen alone would make the Cost Report tab and its own
    // export show different totals under the same heading for any receipt
    // booked without a price, which is a worse fault than the one it fixes.
    //
    // If the fallback is the wanted behaviour it belongs in the SERVICE first,
    // so the screen and the export move together -- and that is a change to a
    // shipped money report's figures, which needs its own decision, its own
    // test and its own API_CHANGELOG entry. Owner call, not a lane call.
    if (unitCost !== null) running.cost += quantity * unitCost;
    totals.set(receipt.materialId, running);
  }

  return [...totals.entries()]
    .map(([materialId, { quantity, cost }]) => {
      const material = materialById.get(materialId);
      const totalCost = round2(cost);
      return {
        materialId,
        // Same honest fallback the service uses: an unresolvable material is
        // named by its id rather than shown as blank or dropped.
        name: material?.name ?? materialId,
        spec: material?.spec ?? null,
        unit: material?.unit ?? "",
        totalQuantityReceived: quantity,
        totalCost,
        averageUnitCost: quantity > 0 ? round2(totalCost / quantity) : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
