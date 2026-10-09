import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { boqTotal, collectLines, draftBoqTotal, draftLineAmount, derivedSubQtyRate, childPercentSum, lineMissingFields, missingBoqFields, unitForLine, type BoqLineItemRow, type LineItemDraft } from "@/lib/boq-helpers";
import { budgetTotals, budgetVariance, filterBudgetLines, groupBudgetLinesByCategory, isOverBudget, lineActual, grandTotalTies, budgetPercentError, vendorAmountError, type BudgetLine } from "@/lib/budget-lines";
import { createFakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";
import { createReplica } from "@/lib/local-first/replica";
import { formatMoney, formatSignedMoney } from "@/lib/format-money";

// MATRIX category 4: business logic (BOQ arithmetic, budgets, variance, money hidden for client viewers). Cases M04-01 ... M04-34.

const L = (o: Partial<LineItemDraft>): LineItemDraft => ({ description: "d", unit: "m2", quantity: "", rate: "", ...o });
const bl = (o: Partial<BudgetLine>): BudgetLine => ({
  lineItemId: "l", code: null, description: "d", amount: 1000, category: null, budgetPercentage: 25, budget: 250,
  materialAmount: null, manpowerAmount: null, vendorId: null, vendorName: null, vendorAmount: null, committed: null, variance: null, revenue: null, ...o,
} as BudgetLine);
const row = (o: Partial<BoqLineItemRow> & { id: string }): BoqLineItemRow => ({ amount: "0", quantity: "0", rate: "0", parentLineItemId: null, breakdownPercentage: null, ...o } as unknown as BoqLineItemRow);

describe("M04 BOQ arithmetic", () => {
  test.each([["10", "100", 1000], ["0.5", "200", 100], ["3", "33.33", 99.99], ["1000", "0", 0]])("M04-01 root amount %p x %p = %p", (q, r, want) => {
    const l = L({ quantity: q, rate: r });
    expect(draftLineAmount(l, [l])).toBeCloseTo(want, 6);
  });
  test("M04-02 a blank qty or rate gives no amount (null), never 0", () => {
    const l = L({ quantity: "5" });
    expect(draftLineAmount(l, [l])).toBeNull();
  });
  test("M04-03 non-numeric rate gives null, not NaN", () => {
    const l = L({ quantity: "5", rate: "abc" });
    expect(draftLineAmount(l, [l])).toBeNull();
  });
  test("M04-04 child = root qty x (root rate x pct/100)", () => {
    const p = L({ itemCode: "1", quantity: "10", rate: "200" });
    const c = L({ itemCode: "1.1", parentItemCode: "1", breakdownPercentage: "25" });
    expect(draftLineAmount(c, [p, c])).toBe(500);
  });
  test("M04-05 grandchild prices off the ROOT, not the middle line", () => {
    const p = L({ itemCode: "1", quantity: "10", rate: "100" });
    const c = L({ itemCode: "1.1", parentItemCode: "1", breakdownPercentage: "50" });
    const g = L({ itemCode: "1.1.1", parentItemCode: "1.1", breakdownPercentage: "10" });
    expect(draftLineAmount(g, [p, c, g])).toBe(100); // 10 x (100 x 10%)
  });
  test("M04-06 BOQ total counts root lines only (children are inside the parent)", () => {
    const p = L({ itemCode: "1", quantity: "10", rate: "100" });
    const c = L({ itemCode: "1.1", parentItemCode: "1", breakdownPercentage: "40" });
    const q = L({ itemCode: "2", quantity: "1", rate: "50" });
    expect(draftBoqTotal([p, c, q])).toBe(1050);
  });
  test("M04-07 saved-row total ignores sub-tasks too", () => {
    expect(boqTotal([row({ id: "a", amount: "1000" }), row({ id: "b", amount: "400", parentLineItemId: "a" }), row({ id: "c", amount: "50.5" })])).toBeCloseTo(1050.5, 6);
  });
  test("M04-08 parent cycle does not hang: derivedSubQtyRate returns null", () => {
    const a = row({ id: "a", parentLineItemId: "b", breakdownPercentage: "10" });
    const b = row({ id: "b", parentLineItemId: "a", breakdownPercentage: "10" });
    expect(derivedSubQtyRate(a, [a, b])).toBeNull();
  });
  test("M04-09 saved child derives qty and rate share from its root", () => {
    const root = row({ id: "r", quantity: "20", rate: "300" });
    const child = row({ id: "c", parentLineItemId: "r", breakdownPercentage: "10" });
    expect(derivedSubQtyRate(child, [root, child])).toEqual({ qty: 20, rate: 30 });
  });
  test("M04-10 child percent sum adds the siblings and is null without children", () => {
    const ls = [L({ itemCode: "1" }), L({ parentItemCode: "1", breakdownPercentage: "60" }), L({ parentItemCode: "1", breakdownPercentage: "30" })];
    expect(childPercentSum(ls, "1")).toBe(90);
    expect(childPercentSum(ls, "9")).toBeNull();
    expect(childPercentSum(ls, undefined)).toBeNull();
  });
  test("M04-11 a sub-line inherits its parent's unit; a root with no unit is missing it", () => {
    const ls = [L({ itemCode: "1", unit: "kg", quantity: "1", rate: "1" }), L({ unit: "", parentItemCode: "1", breakdownPercentage: "5" }), L({ unit: "", quantity: "1", rate: "1" })];
    expect(unitForLine(ls, 1)).toBe("kg");
    expect(lineMissingFields(ls, 1)).toEqual([]);
    expect(lineMissingFields(ls, 2)).toEqual(["unit"]);
  });
  test("M04-12 a blank extra row is ignored; a half-filled row refuses the whole save and says which line", () => {
    expect(collectLines([L({ quantity: "1", rate: "1" }), L({ description: "", unit: "" })]).valid.length).toBe(1);
    const r = collectLines([L({ quantity: "1", rate: "1" }), L({ description: "Half", unit: "", quantity: "" })]);
    expect(r.valid).toEqual([]);
    expect(r.error).toContain("Line 2");
  });
  test("M04-13 title-only BOQ (no lines) is legitimate; missing title is named", () => {
    expect(collectLines([L({ description: "", unit: "" })])).toEqual({ valid: [], error: null });
    expect(missingBoqFields("", [L({ quantity: "1", rate: "1" })])).toEqual(["Title"]);
    expect(missingBoqFields("T", [L({ quantity: "1" })])).toEqual(["Line 1"]);
  });
});

describe("M04 budgets", () => {
  test("M04-14 actual is vendor + material + manpower; all null stays null (not 0)", () => {
    expect(lineActual({ vendorAmount: 100, materialAmount: 50, manpowerAmount: null })).toBe(150);
    expect(lineActual({ vendorAmount: null, materialAmount: null, manpowerAmount: null })).toBeNull();
    expect(lineActual({ vendorAmount: 0, materialAmount: null, manpowerAmount: null })).toBe(0);
  });
  test("M04-15 over budget only when actual strictly exceeds budget", () => {
    expect(isOverBudget(bl({ budget: 100, vendorAmount: 100 }))).toBe(false);
    expect(isOverBudget(bl({ budget: 100, vendorAmount: 100.01 }))).toBe(true);
    expect(isOverBudget(bl({ budget: 100 }))).toBe(false);
  });
  test("M04-16 variance = budget - actual (negative = over); null until costed; rounded to 2dp", () => {
    expect(budgetVariance(bl({ budget: 100, vendorAmount: 130 }))).toBe(-30);
    expect(budgetVariance(bl({ budget: 100 }))).toBeNull();
    expect(budgetVariance(bl({ budget: 0.3, vendorAmount: 0.1 }))).toBe(0.2);
  });
  test("M04-17 grouping: first-appearance order, Uncategorized last, grand total is the sum of root lines", () => {
    const lines = [bl({ lineItemId: "1", category: "Civil", amount: 100, budget: 25 }), bl({ lineItemId: "2", category: null, amount: 50, budget: 12.5 }), bl({ lineItemId: "3", category: "Electrical", amount: 200, budget: 50 })];
    const g = groupBudgetLinesByCategory(lines) as unknown as { groups: { category: string; subtotal: { amount: number } }[]; grandTotal: { amount: number; budget: number } };
    expect(g.groups.map((x) => x.category)).toEqual(["Civil", "Electrical", "Uncategorized"]);
    expect(g.grandTotal.amount).toBe(350);
    expect(g.grandTotal.budget).toBe(87.5);
  });
  test("M04-18 grouping: a weighted child is not added on top of its parent", () => {
    const lines = [bl({ lineItemId: "1", amount: 100, budget: 25 }), bl({ lineItemId: "2", amount: 40, budget: 10, parentLineItemId: "1" })];
    const g = groupBudgetLinesByCategory(lines) as unknown as { grandTotal: { amount: number } };
    expect(g.grandTotal.amount).toBe(100);
  });
  test("M04-19 category filter is case-insensitive and a blank filter means everything", () => {
    const lines = [bl({ lineItemId: "1", category: "Civil" }), bl({ lineItemId: "2", category: "Electrical" })];
    const only = groupBudgetLinesByCategory(lines, ["civil"]) as unknown as { grandTotal: { amount: number } };
    expect(only.grandTotal.amount).toBe(1000);
    const all = groupBudgetLinesByCategory(lines, ["  "]) as unknown as { grandTotal: { amount: number } };
    expect(all.grandTotal.amount).toBe(2000);
  });
  test("M04-20 filters combine: category AND vendor", () => {
    const lines = [bl({ lineItemId: "1", category: "Civil", vendorName: "Acme" }), bl({ lineItemId: "2", category: "Civil", vendorName: "Zed" }), bl({ lineItemId: "3", category: "Electrical", vendorName: "Acme" })];
    expect(filterBudgetLines(lines, { category: "Civil", vendor: "Acme" }).map((x) => x.lineItemId)).toEqual(["1"]);
    expect(filterBudgetLines(lines, { category: "", vendor: "" }).length).toBe(3);
    expect(filterBudgetLines(lines, { category: "No category", vendor: "" }).length).toBe(0);
  });
  test("M04-21 totals skip nulls; unquoted lines do not drag vendor total; over-budget count uses negative variance", () => {
    const lines = [bl({ budget: 100, vendorAmount: 120, variance: -20 }), bl({ budget: 100, vendorAmount: null, variance: null }), bl({ budget: 50, vendorAmount: 10, variance: 40 })];
    const t = budgetTotals(lines);
    expect(t.budget).toBe(250);
    expect(t.vendorAmount).toBe(130);
    expect(t.quotedLines).toBe(2);
    expect(t.overBudgetLines).toBe(1);
    expect(budgetTotals([]).vendorAmount).toBeNull();
  });
  test.each([["", false], ["abc", false], ["-1", false], ["101", false], ["0", true], ["100", true], ["25.5", true], [" 40 ", true]])("M04-22 budget percent %p valid=%p", (raw, ok) => {
    expect(budgetPercentError(raw) === undefined).toBe(ok);
  });
  test.each([["", true], ["abc", false], ["-5", false], ["0", true], ["1e3", true]])("M04-23 vendor amount %p valid=%p", (raw, ok) => {
    expect(vendorAmountError(raw) === undefined).toBe(ok);
  });
  test("M04-24 grand total ties to the BOQ total within a cent, not beyond", () => {
    expect(grandTotalTies(1000.004, 1000)).toBe(true);
    expect(grandTotalTies(1000.5, 1000)).toBe(false);
  });
  test("M04-25 money: signed money carries a direction glyph and sign", () => {
    expect(formatSignedMoney(2025, { currency: "AED" })).toBe("▲ AED +2,025.00");
    expect(formatSignedMoney(-5, { currency: "AED" })).toBe("▼ AED -5.00");
    expect(formatSignedMoney(0, { currency: "AED" })).toBe("AED 0.00");
  });
  test("M04-26 money: no currency set shows the warning glyph, never a made-up rupee", () => {
    expect(formatMoney(1200, { currency: null })).toBe("⚠ 1,200.00");
    expect(formatMoney(null, { currency: "AED" })).toBe("–");
    expect(formatMoney("1250.5", { currency: "AED" })).toBe("AED 1,250.50");
  });
});

// Money hidden for client viewers: the sync service nulls the money fields and marks the rows redacted; the laptop must keep them null.
describe("M04 money hidden for a client viewer (redacted rows)", () => {
  async function copy(opts: { hidden?: string[]; viewClass?: string }) {
    const s = createFakeSyncServer({ strict: true, ...(opts.hidden ? { hiddenFields: opts.hidden } : {}) });
    if (opts.viewClass) s.viewClass = opts.viewClass;
    s.upsert({ kind: "boq_lines", projectId: "p1", id: "b1", data: { description: "Slab", rate: 120, amount: 12000, quantity: 100 } });
    const idb = new IDBFactory();
    await createReplica({ userId: "u1", client: s.client, idb, yieldFn: async () => {} }).sync();
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    const r = await db.getRecord("boq_lines", "b1");
    db.close();
    return r!;
  }
  test("M04-27 manager copy keeps the figures", async () => {
    expect((await copy({})).data).toMatchObject({ rate: 120, amount: 12000 });
  });
  test("M04-28 client viewer copy: money fields are null on the laptop, the description and quantity stay", async () => {
    const r = await copy({ hidden: ["rate", "amount"] });
    expect(r.data).toMatchObject({ description: "Slab", quantity: 100, rate: null, amount: null });
  });
  test("M04-29 client viewer: not even a raw string of the hidden figures is stored anywhere in the row", async () => {
    const r = await copy({ hidden: ["rate", "amount"] });
    expect(JSON.stringify(r)).not.toContain("12000");
    expect(JSON.stringify(r)).not.toContain("120,");
  });
  test("M04-30 a hidden-money row shows as dash, never as a fake zero, through the money formatter", async () => {
    const r = await copy({ hidden: ["amount"] });
    expect(formatMoney((r.data as { amount: number | null }).amount, { currency: "AED" })).toBe("–");
  });
  test("M04-32 hidden-field set with no matching field changes nothing", async () => {
    expect((await copy({ hidden: ["nonexistent"] })).data).toMatchObject({ amount: 12000 });
  });
  test("M04-33 hidden fields are per field: only the named ones are nulled", async () => {
    const r = await copy({ hidden: ["rate"] });
    expect(r.data).toMatchObject({ rate: null, amount: 12000 });
  });
  test("M04-34 two viewers with different hidden sets, separate databases, never see each other's figures", async () => {
    const a = await copy({ hidden: ["amount"] });
    const b = await copy({});
    expect((a.data as { amount: unknown }).amount).toBeNull();
    expect((b.data as { amount: unknown }).amount).toBe(12000);
  });
});
