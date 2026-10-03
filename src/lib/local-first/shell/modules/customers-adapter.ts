// LOCAL-FIRST shell, Customers (/customers), read from the laptop's own database.
//
// THE ONLINE SCREEN (CustomersClient): a searchable, paged table of Name (a link to the customer), GSTIN (Indian organisations only),
// Credit Limit and a status badge; "New Customer" opens /customers/new.
//
// WHAT THE LAPTOP HAS. Organisation kind `customers` (id, customer_name, client_id, default_payment_terms_days, credit_limit,
// is_active, ...). The sync service sends it only to a member and above (a viewer / client viewer never receives customer master
// data: loadOrgLocal says "not_allowed" and the screen says so), and `credit_limit` is NULL below the role that may see cost (named
// in the done marker's hidden fields): shown as "Hidden for your role", its value dropped here even if a row carries one.
// GSTIN and every other tax id are NOT synced (left out on purpose by the server); the screen says tax ids stay on the server.
//
// Read-only: creating or editing a customer is done on the server (the screen links to it when online). The customer's own page
// (/customers/:id) is not drawn here; it opens from the server when online.

import type { ShellData } from "../context";
import { loadOrgLocal } from "../../org-local";
import { moneyMasters, type Currency } from "./org-masters";
import { bool, isHidden, num, rowWithId, text, type Obj } from "./finance-local";

export type Customer = { id: string; name: string; isActive: boolean; creditLimit: number | null; paymentTermsDays: number | null };

export type CustomersData =
  | { state: "not_allowed" }
  | { state: "not_synced" }
  | { state: "local"; customers: Customer[]; creditHidden: boolean; base: Currency | null; syncedAt: number };

export async function loadCustomers(data: ShellData): Promise<CustomersData> {
  const access = { userId: data.userId, idb: data.idb };
  const r = await loadOrgLocal("customers", access);
  if (r.state !== "local") return { state: r.state };
  const creditHidden = isHidden(r.hiddenFields, "credit_limit");
  const customers: Customer[] = [];
  for (const raw of r.rows) {
    const o: (Obj & { id: string }) | null = rowWithId(raw);
    const name = o && text(o, "customer_name");
    if (!o || !name) continue;
    customers.push({
      id: o.id, name,
      // a row without the flag is treated as active: the online list shows it as active too
      isActive: bool(o, "is_active") ?? true,
      creditLimit: creditHidden ? null : num(o, "credit_limit"),
      paymentTermsDays: num(o, "default_payment_terms_days"),
    });
  }
  customers.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const money = await moneyMasters(access);
  return { state: "local", customers, creditHidden, base: money.state === "local" ? money.base : null, syncedAt: r.syncedAt };
}
