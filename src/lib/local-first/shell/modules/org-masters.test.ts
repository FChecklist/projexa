// lf-e7: the organisation masters a module adapter takes (org-masters.ts), read from the laptop only, through the real replica copy.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeOrgServer, seedOrgWorld, type Role } from "../../__fixtures__/fake-org-client";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createReplica } from "../../replica";
import { ORG_PROJECT } from "../../sync-client";
// PLANTED-BUG FORM for the cost rule (a role gate, never broken in place): LF_E7_MASTERS_MUTANT = absolute path of a modified copy.
const mod: typeof import("./org-masters") = await import(process.env.LF_E7_MASTERS_MUTANT ?? "./org-masters");
const { costRule, departmentPicker, formatInBase, hiddenCostFields, moneyMasters, orgMasters, peopleNames, peoplePicker, roleRank, vendorNames } = mod;

const U = "signin-1";
let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => { fetchSpy = spyOn(globalThis, "fetch"); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });

async function synced(role: Role, more?: (s: ReturnType<typeof createFakeOrgServer>) => void) {
  const idb = new IDBFactory();
  const server = createFakeOrgServer({ signInId: U, role });
  seedOrgWorld(server);
  more?.(server);
  expect((await createReplica({ userId: U, client: server.client, idb, yieldFn: async () => {} }).sync()).status).toBe("done");
  return { userId: U, idb };
}

describe("names and pickers", () => {
  test("vendor and people names by id, for a member", async () => {
    const access = await synced("member");
    const v = await vendorNames(access);
    expect(v.state === "local" ? [...v.names] : v).toEqual([["ven-1", "Ace Cement"], ["ven-2", "Bright Paints"]]);
    const p = await peopleNames(access);
    expect(p.state === "local" ? p.names.get("u-mgr") : p).toBe("Mira Manager");
  });

  test("a viewer: vendor names are 'not_allowed' (show the id, never a guessed name)", async () => {
    const access = await synced("viewer");
    expect(await vendorNames(access)).toEqual({ state: "not_allowed" });
    expect(await peoplePicker(access)).toEqual({ state: "not_allowed" });
  });

  test("the people picker offers active people only, sorted by name; a nameless row is left out", async () => {
    const access = await synced("member", (s) => {
      s.upsert(ORG_PROJECT, "org_people", "u-old", { name: "Ola Old", is_active: false });
      s.upsert(ORG_PROJECT, "org_people", "u-anon", { name: "  " });
      s.upsert(ORG_PROJECT, "org_people", "u-ann", { name: "Ann Able", is_active: true });
    });
    const p = await peoplePicker(access);
    expect(p.state === "local" ? p.options : p).toEqual([{ id: "u-ann", label: "Ann Able" }, { id: "u-mgr", label: "Mira Manager" }]);
    const d = await departmentPicker(access);
    expect(d.state === "local" ? d.options : d).toEqual([{ id: "dep-1", label: "Site Execution" }]);
  });

  test("nothing synced: every master says 'not_synced'", async () => {
    const access = { userId: U, idb: new IDBFactory() };
    for (const f of [orgMasters.vendorNames, orgMasters.customerNames, orgMasters.companyNames, orgMasters.peopleNames]) expect(await f(access)).toEqual({ state: "not_synced" });
    expect(await orgMasters.moneyMasters(access)).toEqual({ state: "not_synced" });
    expect(await orgMasters.costRule("manager", access)).toEqual({ state: "not_synced" });
  });
});

describe("money display", () => {
  async function withCurrencies() {
    const access = { userId: U, idb: new IDBFactory() };
    const db = await openLocalDb(access.idb, localDbNameFor(U));
    await db.setMeta("sync:manifest", { userId: U, orgId: "org-a", projectIds: [], kinds: [], at: 1, orgKinds: ["currencies", "exchange_rates"] });
    const rows: Array<[string, string, Record<string, unknown>]> = [
      ["currencies", "cur-inr", { code: "INR", name: "Indian Rupee", symbol: "₹", is_base_currency: true }],
      ["currencies", "cur-aed", { code: "AED", name: "UAE Dirham" }],
      ["currencies", "cur-bad", { name: "no code" }],
      ["exchange_rates", "fx-1", { from_currency_id: "cur-aed", to_currency_id: "cur-inr", rate: "22.7", rate_date: "2026-10-01" }],
      ["exchange_rates", "fx-2", { from_currency_id: "cur-aed", to_currency_id: "cur-inr", rate: 22.5, rate_date: "2026-09-01" }],
      ["exchange_rates", "fx-bad", { from_currency_id: "cur-aed", to_currency_id: "cur-inr", rate: -1 }],
    ];
    for (const [kind, id, data] of rows) await db.putRecord({ id: `${kind}:${id}`, type: kind, orgId: "org-a", projectId: ORG_PROJECT, data: { id, ...data } });
    await db.setMeta(`sync:done:${ORG_PROJECT}:currencies`, { at: 5, redacted: false, hiddenFields: [] });
    await db.setMeta(`sync:done:${ORG_PROJECT}:exchange_rates`, { at: 5, redacted: false, hiddenFields: [] });
    db.close();
    return access;
  }

  test("the base currency, the currencies with a code, and valid rates newest first", async () => {
    const m = await moneyMasters(await withCurrencies());
    if (m.state !== "local") throw new Error("expected local");
    expect(m.base).toEqual({ id: "cur-inr", code: "INR", name: "Indian Rupee", symbol: "₹" });
    expect([...m.currencies.keys()].sort()).toEqual(["cur-aed", "cur-inr"]);
    expect(m.rates).toEqual([{ from: "cur-aed", to: "cur-inr", rate: 22.7, date: "2026-10-01" }, { from: "cur-aed", to: "cur-inr", rate: 22.5, date: "2026-09-01" }]);
    expect(formatInBase(1200, m.base)).toBe("₹1,200");
    expect(formatInBase(1200, { id: "x", code: "AED", name: null, symbol: null })).toBe("AED 1,200");
    expect(formatInBase(1200, null)).toBeNull();
  });
});

describe("cost visibility: the server's rule on the laptop", () => {
  const config = [{ id: "cv1", role: "manager", can_see_cost: true }, { id: "cv3", role: "senior_professional", can_see_cost: false }];
  const money = ["credit_limit", "rate_project", "project_value", "amount"];

  test("below rank 3 every money column is hidden", () => {
    expect(roleRank("member")).toBe(2);
    expect(hiddenCostFields("member", money, config)).toEqual(money);
    expect(hiddenCostFields("viewer", money, config)).toEqual(money);
    expect(hiddenCostFields(null, money, config)).toEqual(money);
    expect(hiddenCostFields("someone-new", money, config)).toEqual(money); // an unknown role is rank 0
  });

  test("rank 3+: nothing hidden when the organisation grants the role cost; only the project-side cost fields when it does not, or has no row", () => {
    expect(hiddenCostFields("manager", money, config)).toEqual([]);
    expect(hiddenCostFields("senior_professional", money, config)).toEqual(["rate_project", "project_value"]);
    expect(hiddenCostFields("admin", money, config)).toEqual(["rate_project", "project_value"]);
    expect(hiddenCostFields("manager", [], config)).toEqual([]);
  });

  test("costRule reads the organisation's configuration from the laptop (every role, a viewer included, has it)", async () => {
    const access = await synced("viewer");
    const viewerRule = await costRule("viewer", access);
    expect(viewerRule.state === "local" ? viewerRule.hidden(["amount"]) : viewerRule).toEqual(["amount"]);
    const managerRule = await costRule("manager", access);
    expect(managerRule.state === "local" ? managerRule.hidden(["rate_project"]) : managerRule).toEqual([]);
  });
});
