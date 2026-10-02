// LOCAL-FIRST ORGANISATION MASTERS FOR THE SHELL MODULES (package lf-e7). The module adapters (materials, procurement, work progress,
// design-change, ...) list "vendor names", "who recorded it", "the base currency" under GAPS because the client engine did not consume the
// organisation kinds. It does now (replica-org.ts); this file is the one small interface they take those masters through, reading ONLY
// the laptop's own database via loadOrgLocal (org-local.ts). Every answer is a tagged union, so a screen says a calm, true thing:
//   "local"        the master is on the laptop (names, lists, the base currency, the cost rule)
//   "not_allowed"  the person's role does not include it (a viewer never receives vendors): show the id or nothing, never guess
//   "not_synced"   not on this laptop yet
// Rows are untrusted input (filtered, never cast). Nothing here is fabricated: a name that is not on the laptop is absent from the map.
// Money is never computed into a decision here: `hiddenCostFields` only decides what to HIDE, by the server's own rule.
//
// Source columns (drizzle/0684 projexa_sync__org_src): vendors {id, supplier_name, supplier_type, trade, project_id, credit_limit*, ...},
// customers {id, customer_name, client_id, credit_limit*, ...}, companies {id, company_name, abbr, default_currency_id, ...},
// boq_categories {id, name, sort_order, is_active}, currencies {id, code, name, symbol, is_base_currency}, exchange_rates {id,
// from_currency_id, to_currency_id, rate, rate_date}, departments {id, name, description, head_id}, org_people {id, name, role, is_active,
// email (masked except the person's own)}, cost_visibility {id, role, can_see_cost}. (* null below the money rank.)

import type { LocalAccess } from "../../local-reader";
import { loadOrgLocal, type OrgRow } from "../../org-local";

export type MasterState = "not_allowed" | "not_synced";
export type Named = { state: "local"; names: Map<string, string> } | { state: MasterState };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

async function namesOf(kind: string, field: string, access: LocalAccess): Promise<Named> {
  const r = await loadOrgLocal(kind, access);
  if (r.state !== "local") return { state: r.state };
  const names = new Map<string, string>();
  for (const row of r.rows) {
    const name = text(row[field]);
    if (name) names.set(row.id, name);
  }
  return { state: "local", names };
}

/** Supplier names by id (materials receipts, purchase orders, procurement). */
export const vendorNames = (access: LocalAccess = {}) => namesOf("vendors", "supplier_name", access);
/** Customer names by id (sales screens). */
export const customerNames = (access: LocalAccess = {}) => namesOf("customers", "customer_name", access);
/** Company names by id. */
export const companyNames = (access: LocalAccess = {}) => namesOf("companies", "company_name", access);
/** People's names by id ("recorded by", "assigned to"). */
export const peopleNames = (access: LocalAccess = {}) => namesOf("org_people", "name", access);

export type PickerOption = { id: string; label: string };
export type Picker = { state: "local"; options: PickerOption[] } | { state: MasterState };

/** Active people for an assignment picker, by name. An inactive person is not offered. */
export async function peoplePicker(access: LocalAccess = {}): Promise<Picker> {
  const r = await loadOrgLocal("org_people", access);
  if (r.state !== "local") return { state: r.state };
  const options = r.rows.filter((p) => p.is_active !== false && text(p.name)).map((p) => ({ id: p.id, label: text(p.name)! }));
  return { state: "local", options: options.sort((a, b) => a.label.localeCompare(b.label)) };
}

/** Departments for a picker, by name. */
export async function departmentPicker(access: LocalAccess = {}): Promise<Picker> {
  const r = await loadOrgLocal("departments", access);
  if (r.state !== "local") return { state: r.state };
  const options = r.rows.filter((d) => text(d.name)).map((d) => ({ id: d.id, label: text(d.name)! }));
  return { state: "local", options: options.sort((a, b) => a.label.localeCompare(b.label)) };
}

/** Active BOQ categories in the organisation's own order. */
export async function boqCategoryPicker(access: LocalAccess = {}): Promise<Picker> {
  const r = await loadOrgLocal("boq_categories", access);
  if (r.state !== "local") return { state: r.state };
  const rows = r.rows.filter((c) => c.is_active !== false && text(c.name));
  rows.sort((a, b) => (num(a.sort_order) ?? 0) - (num(b.sort_order) ?? 0) || String(a.name).localeCompare(String(b.name)));
  return { state: "local", options: rows.map((c) => ({ id: c.id, label: text(c.name)! })) };
}

export type Currency = { id: string; code: string; name: string | null; symbol: string | null };
export type MoneyMasters =
  | { state: "local"; base: Currency | null; currencies: Map<string, Currency>; rates: Array<{ from: string; to: string; rate: number; date: string | null }> }
  | { state: MasterState };

/** The organisation's currencies, its base currency (null when none is marked) and its exchange rates, newest first. For display only. */
export async function moneyMasters(access: LocalAccess = {}): Promise<MoneyMasters> {
  const cur = await loadOrgLocal("currencies", access);
  if (cur.state !== "local") return { state: cur.state };
  const currencies = new Map<string, Currency>();
  let base: Currency | null = null;
  for (const row of cur.rows) {
    const code = text(row.code);
    if (!code) continue;
    const c: Currency = { id: row.id, code, name: text(row.name), symbol: text(row.symbol) };
    currencies.set(row.id, c);
    if (row.is_base_currency === true && !base) base = c;
  }
  const fx = await loadOrgLocal("exchange_rates", access);
  const rates = fx.state === "local"
    ? fx.rows.flatMap((row: OrgRow) => {
      const from = text(row.from_currency_id);
      const to = text(row.to_currency_id);
      const rate = num(row.rate);
      return from && to && rate !== null && rate > 0 ? [{ from, to, rate, date: text(row.rate_date) }] : [];
    }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    : [];
  return { state: "local", base, currencies, rates };
}

/** "₹1,200" / "AED 1,200" in the base currency, or null when the laptop has no base currency (the screen keeps its own fallback). Pure. */
export function formatInBase(amount: number, base: Currency | null): string | null {
  if (!base || !Number.isFinite(amount)) return null;
  const n = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return base.symbol ? `${base.symbol}${n}` : `${base.code} ${n}`;
}

// ─── cost visibility: the server's rule (drizzle/0624 ai_work_link__hidden_cols, ai_work_link__cost_visible, ai_work_link__role_rank) ──

const RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1, member: 2, team_member: 2, senior_professional: 3, manager: 3,
  branch_manager: 4, admin: 5, veridian_admin: 6,
};
/** The project-side cost fields a rank-3+ role still loses when the organisation does not grant it cost (PROJECT_SIDE_COST_FIELDS). */
export const PROJECT_SIDE_COST_FIELDS: readonly string[] = ["rate_project", "qty_project", "project_value"];

export function roleRank(role: string | null | undefined): number {
  return role ? RANK[role] ?? 0 : 0;
}

/**
 * Which of a kind's money columns a role must not see, exactly as the server decides it: below rank 3 every one; from rank 3 none when
 * the organisation's cost-visibility configuration grants the role cost (a client_viewer never), otherwise only the project-side cost
 * fields. `config` is the cost_visibility rows; a role with no row is NOT granted (the server's coalesce(..., false)). Pure.
 */
export function hiddenCostFields(role: string | null | undefined, moneyColumns: readonly string[], config: readonly OrgRow[]): string[] {
  if (moneyColumns.length === 0) return [];
  if (roleRank(role) < 3) return [...moneyColumns];
  const granted = role !== "client_viewer" && config.some((c) => c.role === role && c.can_see_cost === true);
  return granted ? [] : moneyColumns.filter((c) => PROJECT_SIDE_COST_FIELDS.includes(c));
}

export type CostRule = { state: "local"; hidden: (moneyColumns: readonly string[]) => string[] } | { state: "not_synced" };

/**
 * The cost rule for the signed-in person's role, from the organisation's own configuration on this laptop. Every role may read the
 * configuration, so "not_allowed" cannot happen; "not_synced" means the screen must keep hiding money as it does today.
 */
export async function costRule(role: string | null | undefined, access: LocalAccess = {}): Promise<CostRule> {
  const r = await loadOrgLocal("cost_visibility", access);
  if (r.state !== "local") return { state: "not_synced" };
  const config = r.rows;
  return { state: "local", hidden: (moneyColumns) => hiddenCostFields(role, moneyColumns, config) };
}

/** The one interface a module adapter takes masters through (pass `orgMasters` itself, or a test double). */
export type OrgMasters = {
  vendorNames: typeof vendorNames;
  customerNames: typeof customerNames;
  companyNames: typeof companyNames;
  peopleNames: typeof peopleNames;
  peoplePicker: typeof peoplePicker;
  departmentPicker: typeof departmentPicker;
  boqCategoryPicker: typeof boqCategoryPicker;
  moneyMasters: typeof moneyMasters;
  costRule: typeof costRule;
};

export const orgMasters: OrgMasters = { vendorNames, customerNames, companyNames, peopleNames, peoplePicker, departmentPicker, boqCategoryPicker, moneyMasters, costRule };
