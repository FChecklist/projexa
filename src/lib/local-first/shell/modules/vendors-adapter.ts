// LOCAL-FIRST shell, Vendors (/vendors, /vendors/:id): the organisation's supplier master, read from the laptop's own copy.
//
// Vendors are an ORGANISATION kind (`vendors`, compliance.erp_suppliers; drizzle/0684), not a project one: they are copied under the
// organisation, once, and the sync service sends them only to roles of rank 2 or more -- a viewer never receives them, and the laptop
// then says "your role does not include the organisation's vendors" rather than an empty list. Columns on the wire:
//   id, supplier_name, supplier_type, trade, project_id, default_payment_terms_days, credit_limit*, qualification_status, is_active, created_at, updated_at
// (* money: null below the role that may see cost; named in the pull's hidden fields).
//
// NOT ON THE LAPTOP (GAPS, said on the screen): GST number, contacts and addresses, vendor risks, performance and documents. The online
// object page shows those; the laptop shows what it has and says the rest needs a connection.
//
// Rows are untrusted input: a row without an id and a name is skipped; a wrong-typed value is null (a dash), never coerced.

import { loadOrgLocal } from "../../org-local";
import type { ShellData } from "../context";
import { asRecord } from "./documents-records";

export const VENDORS_KIND = "vendors";

export type LocalVendor = {
  id: string; name: string; type: string | null; trade: string | null; qualification: string | null; isActive: boolean;
  paymentTermsDays: number | null; creditLimit: number | null; creditHidden: boolean;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const numeric = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
};

export function toLocalVendor(raw: unknown, hidden: ReadonlySet<string> = new Set()): LocalVendor | null {
  const o = asRecord(raw);
  const id = o && text(o.id);
  const name = o && text(o.supplier_name);
  if (!o || !id || !name) return null;
  const creditHidden = hidden.has("credit_limit");
  const shown = <T>(col: string, read: (x: unknown) => T): T | null => (hidden.has(col) ? null : read(o[col]));
  return {
    id, name, type: shown("supplier_type", text), trade: shown("trade", text), qualification: shown("qualification_status", text),
    // a vendor row without the flag is active (the online list shows it as such)
    isActive: typeof o.is_active === "boolean" ? o.is_active : true,
    paymentTermsDays: shown("default_payment_terms_days", numeric), creditLimit: creditHidden ? null : numeric(o.credit_limit), creditHidden,
  };
}

export type VendorsListData =
  | { state: "not_allowed" }
  | { state: "not_synced" }
  | { state: "local"; syncedAt: number; rows: LocalVendor[] };

export type VendorObjectData =
  | { state: "not_allowed" }
  | { state: "not_synced" }
  | { state: "not_found" }
  | { state: "local"; syncedAt: number; vendor: LocalVendor };

async function readVendors(data: ShellData): Promise<{ state: "not_allowed" | "not_synced" } | { state: "local"; syncedAt: number; rows: LocalVendor[] }> {
  const r = await loadOrgLocal(VENDORS_KIND, { userId: data.userId, ...(data.idb ? { idb: data.idb } : {}) });
  if (r.state !== "local") return { state: r.state };
  const hidden = new Set(r.hiddenFields);
  const rows = r.rows.map((row) => toLocalVendor(row, hidden)).filter((v): v is LocalVendor => v !== null);
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { state: "local", syncedAt: r.syncedAt, rows };
}

export async function loadVendors(data: ShellData): Promise<VendorsListData> {
  return readVendors(data);
}

export async function loadVendor(data: ShellData, id: string): Promise<VendorObjectData> {
  const r = await readVendors(data);
  if (r.state !== "local") return r;
  const vendor = r.rows.find((v) => v.id === id);
  return vendor ? { state: "local", syncedAt: r.syncedAt, vendor } : { state: "not_found" };
}
