import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deliveryShellData as shellData, seedDelivery, type SeedPair } from "./delivery-test-seed";
import { loadMaterial, loadMaterials, loadReceipt } from "./materials-adapter";

// Materials read from the laptop: the master with stock counted from the laptop's receipts and issues (voided receipts left out, the
// person's own waiting records included), receipts and issues with names, one material, one receipt; cost hidden by role.

const materials = (hidden: string[] = []): SeedPair => ({
  projectId: "p1", kind: "materials", hidden,
  rows: [
    { id: "m1", name: "Cement", unit: "bag", reorder_level: "50", is_active: true, unit_cost: hidden.length ? null : "410.00" },
    { id: "m2", name: "Bricks", unit: "nos", reorder_level: null, is_active: true, unit_cost: hidden.length ? null : 9 },
  ],
});
const receipts = (hidden: string[] = []): SeedPair => ({
  projectId: "p1", kind: "material_receipts", hidden,
  rows: [
    { id: "r1", material_id: "m1", received_date: "2026-09-20", quantity: "100", reference: "DN-1", unit_cost: hidden.length ? null : 410 },
    { id: "r2", material_id: "m1", received_date: "2026-09-25", quantity: 40, voided_at: "2026-09-26T00:00:00Z", void_reason: "wrong site" },
    { id: "local-r", material_id: "m1", received_date: "2026-10-02", quantity: 10, unit_cost: null },
    { id: "r3", material_id: "m2", received_date: "2026-09-21", quantity: "1000.5" },
  ],
});
const issues: SeedPair = {
  projectId: "p1", kind: "material_issues",
  rows: [
    { id: "i1", material_id: "m1", issued_date: "2026-09-28", quantity: 65, boq_line_item_id: "l1", issued_to: "Block crew" },
    { id: "local-i", material_id: "m2", issued_date: "2026-10-02", quantity: "0.5" },
  ],
};
const lines: SeedPair = { projectId: "p1", kind: "boq_lines", rows: [{ id: "l1", item_code: "01", description: "Blocks", unit: "nos", quantity: "200" }] };

describe("the Materials screen", () => {
  test("stock = received (voided left out) minus issued, including what is waiting to be sent; low against the reorder level", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [materials(), receipts(), issues, lines]);
    const r = await loadMaterials(shellData(idb), "p1");
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    const cement = r.materials.find((m) => m.id === "m1")!;
    expect(cement).toMatchObject({ receivedToDate: 110, issuedToDate: 65, onHand: 45, low: true, unitCost: 410 });
    expect(r.materials.find((m) => m.id === "m2")).toMatchObject({ receivedToDate: 1000.5, issuedToDate: 0.5, onHand: 1000, low: false });
    expect(r.materials.map((m) => m.name)).toEqual(["Bricks", "Cement"]);
  });

  test("receipts and issues newest first, with names, BOQ line and the waiting mark", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [materials(), receipts(), issues, lines]);
    const r = await loadMaterials(shellData(idb), "p1");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.receipts!.map((x) => x.id)).toEqual(["local-r", "r2", "r3", "r1"]);
    expect(r.receipts![0]).toMatchObject({ waiting: true, materialName: "Cement", unit: "bag" });
    expect(r.receipts!.find((x) => x.id === "r2")!.voided).toBe(true);
    expect(r.issues!.map((x) => x.id)).toEqual(["local-i", "i1"]);
    expect(r.issues![1]).toMatchObject({ boqLabel: "01 · Blocks", issuedTo: "Block crew", materialName: "Cement" });
  });

  test("half a ledger is not a stock figure: with issues not on the laptop, on hand is null", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [materials(), receipts(), { ...issues, synced: false }]);
    const r = await loadMaterials(shellData(idb), "p1");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.materials.find((m) => m.id === "m1")).toMatchObject({ receivedToDate: 110, issuedToDate: null, onHand: null, low: false });
    expect(r.issues).toBeNull();
  });

  test("a role without cost visibility never sees a unit cost, even one a row carries", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...materials(["unit_cost"]), rows: [{ id: "m1", name: "Cement", unit: "bag", unit_cost: "410" }] }, receipts(["unit_cost", "vendor_id"]), issues]);
    const r = await loadMaterials(shellData(idb, { role: "viewer" }), "p1");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.costHidden).toBe(true);
    expect(r.materials[0]!.unitCost).toBeNull();
    expect(r.receipts!.every((x) => x.unitCost === null)).toBe(true);
  });

  test("not synced / no project / another person's database", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...materials(), synced: false }]);
    expect(await loadMaterials(shellData(idb), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadMaterials(shellData(idb), null)).toEqual({ state: "no_project" });
    const idb2 = new IDBFactory();
    await seedDelivery(idb2, [materials(), receipts(), issues], { userId: "u2" });
    expect((await loadMaterials(shellData(idb2), "p1")).state).toBe("not_synced");
  });
});

describe("one material, one receipt", () => {
  test("a material with its own receipts and issues; a receipt found without ?projectId=", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [materials(), receipts(), issues, lines]);
    const m = await loadMaterial(shellData(idb), "m1", "p1");
    if (m.state !== "local") throw new Error("unreachable");
    expect(m.material.onHand).toBe(45);
    expect(m.receipts!.map((x) => x.id)).toEqual(["local-r", "r2", "r1"]);
    expect(m.issues!.map((x) => x.id)).toEqual(["i1"]);
    const rec = await loadReceipt(shellData(idb), "r1", null);
    expect(rec.state === "local" && rec.receipt.reference).toBe("DN-1");
    expect(await loadReceipt(shellData(idb), "nope", "p1")).toEqual({ state: "not_found", projectId: "p1" });
  });
});
