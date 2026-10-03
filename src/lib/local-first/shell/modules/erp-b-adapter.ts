// LOCAL-FIRST shell, group "ERP B": accounting (accounts + fiscal years), budgets, quotations, sales orders, invoices, the sales hub
// and employees (HR), all read from the laptop's own database. One file of read adapters, no React, no server.
//
// WHAT THE LAPTOP HAS (compliance-tracker drizzle/0691_projexa_sync_erp_hr_kinds.sql; every kind is ORGANISATION-scoped):
//   accounts      {id, account_name, account_number, parent_account_id, root_type, account_type, is_group, currency_id, is_frozen}   rank 2
//   fiscal_years  {id, year_name, start_date, end_date, is_closed}                                                                    rank 2
//   budgets       {id, fiscal_year_id, company_id, cost_center_id, name, action_if_exceeded, status, submitted_at}  HEADER ONLY       rank 3
//   quotations    {id, customer_id, quotation_number, quotation_date, valid_till, status, grand_total*, version, revision_of, ...}   rank 2
//   sales_orders  {id, customer_id, quotation_id, so_number, order_date, delivery_date, status, grand_total*, ...}                   rank 2
//   invoices      {id, client_id, customer_id, invoice_number, posting_date, due_date, subtotal*, tax_amount*, grand_total*,
//                  outstanding_amount*, status, sales_order_id, e_invoice_status, ...}                                               rank 2
//   employees     {id, user_id, employee_code, job_title, employment_type, date_of_joining, employment_status, company_id}          rank 2
//   (* money: NULL below rank 3 AND for a role the organisation does not let see cost; the done marker names the hidden columns, and
//    that list is the only authority: a value a row still carries for a hidden column is dropped here.)
//
// NOT ON THE LAPTOP, ON PURPOSE: journal entries and their lines, budget lines, quotation / sales-order / invoice lines (header rows
// only: the screens say so and link to the server when online); an employee's date of birth, emergency contact and tax slab (the
// kind omits them: nothing here reads or shows them); payroll, leave, recruitment, CRM leads. Money, totals and approvals are never
// computed on the laptop: every figure is the one the server sent, a missing one is a dash, a hidden one says so.
//
// Every result is a tagged union ("not_allowed" = the role is not sent the kind, "not_synced" = not copied yet) so a screen says a calm,
// true thing. Replica rows are untrusted input: a row is used only when it is a plain object with a string id and the fields the
// screen needs; everything else is read through tolerant readers, never cast.

import type { ShellData } from "../context";
import { loadOrgLocal } from "../../org-local";
import { companyNames, customerNames, moneyMasters, peopleNames, type Currency, type MoneyMasters } from "./org-masters";
import { bool, day, isHidden, num, rowWithId, text, type Obj } from "./finance-local";

export type Gate = { state: "not_allowed" } | { state: "not_synced" };

const access = (data: ShellData) => ({ userId: data.userId, idb: data.idb });

/** Newest date first, then id: a stable order that does not depend on how the rows arrived. */
const byDateDesc = <T extends { date: string | null; id: string }>(a: T, b: T) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id);

// --- accounting -----------------------------------------------------------------------------------------------------------------------------

export type Account = { id: string; name: string; number: string | null; rootType: string | null; accountType: string | null; isGroup: boolean; isFrozen: boolean; depth: number };
export type FiscalYear = { id: string; name: string; startDate: string | null; endDate: string | null; isClosed: boolean };
export type Section<T> = { state: "local"; rows: T[]; syncedAt: number } | Gate;
export type AccountingData = { accounts: Section<Account>; fiscalYears: Section<FiscalYear> };

export async function loadAccounting(data: ShellData): Promise<AccountingData> {
  const [acc, fy] = await Promise.all([loadOrgLocal("accounts", access(data)), loadOrgLocal("fiscal_years", access(data))]);
  let accounts: Section<Account> = acc.state === "local" ? { state: "local", rows: [], syncedAt: acc.syncedAt } : { state: acc.state };
  if (acc.state === "local") {
    const parsed: Array<{ o: Obj & { id: string }; name: string }> = [];
    for (const raw of acc.rows) {
      const o = rowWithId(raw);
      const name = o && text(o, "account_name");
      if (o && name) parsed.push({ o, name });
    }
    const parentOf = new Map(parsed.map((p) => [p.o.id, text(p.o, "parent_account_id")]));
    // depth is only for indenting: the walk is bounded, so a parent cycle in a bad row cannot hang the screen
    const depthOf = (id: string): number => {
      let d = 0;
      let cur = parentOf.get(id) ?? null;
      while (cur && parentOf.has(cur) && d < 12) { d += 1; cur = parentOf.get(cur) ?? null; }
      return d;
    };
    const rows: Account[] = parsed.map(({ o, name }) => ({
      id: o.id, name, number: text(o, "account_number"), rootType: text(o, "root_type"), accountType: text(o, "account_type"),
      isGroup: bool(o, "is_group") ?? false, isFrozen: bool(o, "is_frozen") ?? false, depth: depthOf(o.id),
    }));
    rows.sort((a, b) => (a.number ?? "￿").localeCompare(b.number ?? "￿") || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    accounts = { state: "local", rows, syncedAt: acc.syncedAt };
  }
  const fiscalYears = fiscalYearsOf(fy);
  return { accounts, fiscalYears };
}

function fiscalYearsOf(fy: Awaited<ReturnType<typeof loadOrgLocal>>): Section<FiscalYear> {
  if (fy.state !== "local") return { state: fy.state };
  const rows: FiscalYear[] = [];
  for (const raw of fy.rows) {
    const o = rowWithId(raw);
    const name = o && text(o, "year_name");
    if (!o || !name) continue;
    rows.push({ id: o.id, name, startDate: day(o, "start_date"), endDate: day(o, "end_date"), isClosed: bool(o, "is_closed") ?? false });
  }
  rows.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.id.localeCompare(b.id));
  return { state: "local", rows, syncedAt: fy.syncedAt };
}

// --- budgets (header only) ------------------------------------------------------------------------------------------------------------------

export type Budget = { id: string; name: string; fiscalYear: string | null; company: string | null; status: string | null; actionIfExceeded: string | null; submittedAt: string | null };
export type BudgetsData = Gate | { state: "local"; budgets: Budget[]; syncedAt: number };
export type BudgetData = Gate | { state: "not_found" } | { state: "local"; budget: Budget; syncedAt: number };

async function readBudgets(data: ShellData): Promise<BudgetsData> {
  const r = await loadOrgLocal("budgets", access(data));
  if (r.state !== "local") return { state: r.state };
  // names are display only: a year or company that is not on the laptop is left blank, never shown as an id
  const [fy, companies] = await Promise.all([loadOrgLocal("fiscal_years", access(data)), companyNames(access(data))]);
  const years = new Map<string, string>();
  const fySection = fiscalYearsOf(fy);
  if (fySection.state === "local") for (const y of fySection.rows) years.set(y.id, y.name);
  const budgets: Budget[] = [];
  for (const raw of r.rows) {
    const o = rowWithId(raw);
    const name = o && text(o, "name");
    if (!o || !name) continue;
    const fyId = text(o, "fiscal_year_id");
    const coId = text(o, "company_id");
    budgets.push({
      id: o.id, name,
      fiscalYear: fyId ? years.get(fyId) ?? null : null,
      company: coId && companies.state === "local" ? companies.names.get(coId) ?? null : null,
      status: text(o, "status"), actionIfExceeded: text(o, "action_if_exceeded"), submittedAt: day(o, "submitted_at"),
    });
  }
  budgets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { state: "local", budgets, syncedAt: r.syncedAt };
}

export const loadBudgets = (data: ShellData): Promise<BudgetsData> => readBudgets(data);

export async function loadBudget(data: ShellData, id: string): Promise<BudgetData> {
  const all = await readBudgets(data);
  if (all.state !== "local") return all;
  const budget = all.budgets.find((b) => b.id === id);
  return budget ? { state: "local", budget, syncedAt: all.syncedAt } : { state: "not_found" };
}

// --- quotations, sales orders, invoices (header rows) ---------------------------------------------------------------------------------------

export type DocKind = "quotations" | "sales_orders" | "invoices";

type DocSpec = {
  label: string; plural: string; base: string; numberCol: string; dateCol: string; dueCol: string; dueLabel: string;
  customerCols: readonly string[]; money: readonly string[];
};
export const DOC_SPECS: Record<DocKind, DocSpec> = {
  quotations: { label: "Quotation", plural: "Quotations", base: "/quotations", numberCol: "quotation_number", dateCol: "quotation_date", dueCol: "valid_till", dueLabel: "Valid till", customerCols: ["customer_id"], money: ["grand_total"] },
  sales_orders: { label: "Sales order", plural: "Sales Orders", base: "/sales-orders", numberCol: "so_number", dateCol: "order_date", dueCol: "delivery_date", dueLabel: "Delivery date", customerCols: ["customer_id"], money: ["grand_total"] },
  invoices: { label: "Invoice", plural: "Invoices", base: "/invoices", numberCol: "invoice_number", dateCol: "posting_date", dueCol: "due_date", dueLabel: "Due date", customerCols: ["customer_id", "client_id"], money: ["subtotal", "tax_amount", "grand_total", "outstanding_amount"] },
};

export type SalesDoc = {
  id: string; kind: DocKind; number: string | null; date: string | null; due: string | null; status: string | null;
  customerName: string | null; projectName: string | null;
  total: number | null; subtotal: number | null; tax: number | null; outstanding: number | null; version: number | null;
  currency: Currency | null; eInvoiceStatus: string | null;
  /** The ids this header points at, for links the screen offers only when that header is on the laptop too. */
  quotationId: string | null; salesOrderId: string | null; revisionOf: string | null;
};
export type DocsData =
  | Gate
  | { state: "local"; kind: DocKind; docs: SalesDoc[]; hidden: Record<string, boolean>; syncedAt: number; statuses: string[] };
export type DocData =
  | Gate
  | { state: "not_found"; kind: DocKind }
  | { state: "local"; kind: DocKind; doc: SalesDoc; hidden: Record<string, boolean>; syncedAt: number; related: Related };
/** What the detail screen may link to: only ids whose own header is on this laptop. */
export type Related = { quotationOnLaptop: boolean; salesOrderOnLaptop: boolean; revisionOnLaptop: boolean; orderedFrom: string[]; invoicedFrom: string[] };

function currencyOf(o: Obj, m: MoneyMasters): Currency | null {
  if (m.state !== "local") return null;
  const id = text(o, "currency_id");
  return (id && m.currencies.get(id)) || m.base;
}

async function readDocs(data: ShellData, kind: DocKind): Promise<DocsData> {
  const spec = DOC_SPECS[kind];
  const r = await loadOrgLocal(kind, access(data));
  if (r.state !== "local") return { state: r.state };
  const hidden: Record<string, boolean> = {};
  for (const col of spec.money) hidden[col] = isHidden(r.hiddenFields, col);
  const [customers, masters] = await Promise.all([customerNames(access(data)), moneyMasters(access(data))]);
  const projects = new Map(data.projects.map((p) => [p.id, p.name]));
  const docs: SalesDoc[] = [];
  for (const raw of r.rows) {
    const o = rowWithId(raw);
    if (!o) continue;
    const numberRaw = num(o, spec.numberCol);
    const number = numberRaw !== null ? String(numberRaw) : text(o, spec.numberCol);
    const date = day(o, spec.dateCol);
    // a header with neither a number nor a date is not a document this screen can name
    if (number === null && date === null) continue;
    const customerId = spec.customerCols.map((c) => text(o, c)).find((v) => v !== null) ?? null;
    const projectId = text(o, "project_id");
    // a hidden money column is dropped even when the row still carries a value
    const money = (col: string) => (hidden[col] || !spec.money.includes(col) ? null : num(o, col));
    docs.push({
      id: o.id, kind, number, date, due: day(o, spec.dueCol), status: text(o, "status"),
      customerName: customerId && customers.state === "local" ? customers.names.get(customerId) ?? null : null,
      projectName: projectId ? projects.get(projectId) ?? null : null,
      total: money("grand_total"), subtotal: money("subtotal"), tax: money("tax_amount"), outstanding: money("outstanding_amount"),
      version: num(o, "version"), currency: currencyOf(o, masters), eInvoiceStatus: text(o, "e_invoice_status"),
      quotationId: text(o, "quotation_id"), salesOrderId: text(o, "sales_order_id"), revisionOf: text(o, "revision_of"),
    });
  }
  docs.sort(byDateDesc);
  const statuses = [...new Set(docs.map((d) => d.status).filter((s): s is string => s !== null))].sort();
  return { state: "local", kind, docs, hidden, syncedAt: r.syncedAt, statuses };
}

export const loadSalesDocs = (data: ShellData, kind: DocKind): Promise<DocsData> => readDocs(data, kind);

export async function loadSalesDoc(data: ShellData, kind: DocKind, id: string): Promise<DocData> {
  const all = await readDocs(data, kind);
  if (all.state !== "local") return all;
  const doc = all.docs.find((d) => d.id === id);
  if (!doc) return { state: "not_found", kind };
  // links only to headers that really are here (an id the laptop does not hold is never offered as a link)
  const exists = async (other: DocKind, otherId: string | null) => {
    if (!otherId) return false;
    const r = await readDocs(data, other);
    return r.state === "local" && r.docs.some((d) => d.id === otherId);
  };
  const orderedFrom = kind === "quotations" ? ((await readDocs(data, "sales_orders")) as DocsData) : null;
  const invoicedFrom = kind === "sales_orders" ? ((await readDocs(data, "invoices")) as DocsData) : null;
  const related: Related = {
    quotationOnLaptop: kind === "sales_orders" ? await exists("quotations", doc.quotationId) : false,
    salesOrderOnLaptop: kind === "invoices" ? await exists("sales_orders", doc.salesOrderId) : false,
    revisionOnLaptop: kind === "quotations" ? await exists("quotations", doc.revisionOf) : false,
    orderedFrom: orderedFrom && orderedFrom.state === "local" ? orderedFrom.docs.filter((d) => d.quotationId === id).map((d) => d.id) : [],
    invoicedFrom: invoicedFrom && invoicedFrom.state === "local" ? invoicedFrom.docs.filter((d) => d.salesOrderId === id).map((d) => d.id) : [],
  };
  return { state: "local", kind, doc, hidden: all.hidden, syncedAt: all.syncedAt, related };
}

/** The sales hub: how many headers of each kind are on the laptop (a count of rows, never a sum of money). */
export type SalesHubData = { kinds: Array<{ kind: DocKind } & ({ state: "local"; count: number; syncedAt: number } | Gate)> };

export async function loadSalesHub(data: ShellData): Promise<SalesHubData> {
  const kinds: SalesHubData["kinds"] = [];
  for (const kind of ["quotations", "sales_orders", "invoices"] as const) {
    const r = await readDocs(data, kind);
    kinds.push(r.state === "local" ? { kind, state: "local", count: r.docs.length, syncedAt: r.syncedAt } : { kind, state: r.state });
  }
  return { kinds };
}

// --- employees (HR) -------------------------------------------------------------------------------------------------------------------------

/** No date of birth, no emergency contact, no tax slab: the kind does not carry them and this type has no field for them. */
export type Employee = {
  id: string; userId: string | null; name: string | null; code: string | null; jobTitle: string | null; employmentType: string | null;
  joined: string | null; status: string | null; company: string | null;
};
export type EmployeesData = Gate | { state: "local"; employees: Employee[]; syncedAt: number; statuses: string[] };
export type EmployeeData = Gate | { state: "not_found" } | { state: "local"; employee: Employee; syncedAt: number };

async function readEmployees(data: ShellData): Promise<EmployeesData> {
  const r = await loadOrgLocal("employees", access(data));
  if (r.state !== "local") return { state: r.state };
  const [people, companies] = await Promise.all([peopleNames(access(data)), companyNames(access(data))]);
  const employees: Employee[] = [];
  for (const raw of r.rows) {
    const o = rowWithId(raw);
    if (!o) continue;
    const userId = text(o, "user_id");
    const code = text(o, "employee_code");
    const name = userId && people.state === "local" ? people.names.get(userId) ?? null : null;
    // a profile with neither a name we can resolve nor a code nor a title is not something a person could recognise
    const jobTitle = text(o, "job_title");
    if (name === null && code === null && jobTitle === null) continue;
    const coId = text(o, "company_id");
    employees.push({
      id: o.id, userId, name, code, jobTitle, employmentType: text(o, "employment_type"), joined: day(o, "date_of_joining"),
      status: text(o, "employment_status"), company: coId && companies.state === "local" ? companies.names.get(coId) ?? null : null,
    });
  }
  employees.sort((a, b) => (a.name ?? a.code ?? "￿").localeCompare(b.name ?? b.code ?? "￿") || a.id.localeCompare(b.id));
  const statuses = [...new Set(employees.map((e) => e.status).filter((s): s is string => s !== null))].sort();
  return { state: "local", employees, syncedAt: r.syncedAt, statuses };
}

export const loadEmployees = (data: ShellData): Promise<EmployeesData> => readEmployees(data);

/** The online page is keyed by the person's user id; the profile's own id works too. */
export async function loadEmployee(data: ShellData, id: string): Promise<EmployeeData> {
  const all = await readEmployees(data);
  if (all.state !== "local") return all;
  const employee = all.employees.find((e) => e.userId === id) ?? all.employees.find((e) => e.id === id);
  return employee ? { state: "local", employee, syncedAt: all.syncedAt } : { state: "not_found" };
}
