// LOCAL-FIRST shell route cluster "ERP B": accounting, budgets, quotations, sales orders, invoices, the sales hub, employees and HR.
// Every screen reads the laptop's own organisation kinds (modules/erp-b-adapter.ts); header rows only for anything with line items.
// Use nav orders 330 to 369. Not registered (not synced, left to the shell's own "not on this laptop yet" answer): payroll,
// recruitment, grc, kpis, proposals, copilot, leave, loans, CRM leads and opportunities, journal entries, credit notes.
//
// A create screen (/quotations/new, ...) is registered as a server-only route so that "/quotations/new" is never read as the quotation
// whose id is "new" by the "/quotations/:id" route (literal patterns are tried first): online the server's page opens, offline a
// calm sentence says why.

import { defineShellRoute, type ShellRoute } from "../types";
import type { ServerOnlyData } from "../modules/DocumentsServerOnlyScreen";
import { loadAccounting, loadBudget, loadBudgets, loadEmployee, loadEmployees, loadSalesDoc, loadSalesDocs, loadSalesHub, type DocKind } from "../modules/erp-b-adapter";

function serverOnlyRoute(pattern: string, title: string, reason: string): ShellRoute<ServerOnlyData> {
  return defineShellRoute<ServerOnlyData>({
    pattern,
    title,
    load: () => import("../modules/DocumentsServerOnlyScreen"),
    adapter: async (_shell, _params, query) => {
      const search = query.toString();
      return { path: pattern, search: search ? `?${search}` : "", title, reason };
    },
  });
}

const listRoute = (pattern: string, title: string, kind: DocKind, nav: { label: string; order: number }) =>
  defineShellRoute({
    pattern, title, nav,
    load: () => import("../modules/SalesDocListScreen"),
    adapter: async (shell) => ({ kind, result: await loadSalesDocs(shell.data, kind) }),
  });
const objectRoute = (pattern: string, title: string, kind: DocKind) =>
  defineShellRoute({
    pattern, title,
    load: () => import("../modules/SalesDocObjectScreen"),
    adapter: async (shell, params) => ({ kind, result: await loadSalesDoc(shell.data, kind, params.id!) }),
  });
const budgetRoutes = (base: string, nav?: { label: string; order: number }): ShellRoute[] => [
  defineShellRoute({
    pattern: base, title: "Budgets", ...(nav ? { nav } : {}),
    load: () => import("../modules/BudgetsScreen"),
    adapter: async (shell) => ({ base, result: await loadBudgets(shell.data) }),
  }),
  defineShellRoute({
    pattern: `${base}/:id`, title: "Budget",
    load: () => import("../modules/BudgetObjectScreen"),
    adapter: async (shell, params) => ({ base, result: await loadBudget(shell.data, params.id!) }),
  }),
  serverOnlyRoute(`${base}/new`, "New budget", "A budget is built from a fiscal year, accounts and lines on the server, so it needs a connection."),
];
const employeesRoute = (pattern: string, title: string, nav?: { label: string; order: number }) =>
  defineShellRoute({
    pattern, title, ...(nav ? { nav } : {}),
    load: () => import("../modules/EmployeesScreen"),
    adapter: async (shell) => ({ heading: title, result: await loadEmployees(shell.data) }),
  });

export const ROUTES: readonly ShellRoute[] = [
  defineShellRoute({
    pattern: "/accounting", title: "Accounting", nav: { label: "Accounting", order: 330 },
    load: () => import("../modules/AccountingScreen"),
    adapter: (shell) => loadAccounting(shell.data),
  }),
  serverOnlyRoute("/accounting/journal-entries/new", "New journal entry", "Journal entries and their lines are kept on the server, so a new one needs a connection."),
  serverOnlyRoute("/accounting/companies/new", "New company", "A company is created on the server, so it needs a connection."),
  ...budgetRoutes("/finance/budgets", { label: "Budgets", order: 335 }),
  // /budgets is the old door to the same screen (the online page redirects to /finance/budgets)
  ...budgetRoutes("/budgets"),
  defineShellRoute({
    pattern: "/sales", title: "Sales", nav: { label: "Sales", order: 340 },
    load: () => import("../modules/SalesHubScreen"),
    adapter: (shell) => loadSalesHub(shell.data),
  }),
  listRoute("/quotations", "Quotations", "quotations", { label: "Quotations", order: 342 }),
  objectRoute("/quotations/:id", "Quotation", "quotations"),
  serverOnlyRoute("/quotations/new", "New quotation", "A quotation is built from line items and prices on the server, so it needs a connection."),
  listRoute("/sales-orders", "Sales Orders", "sales_orders", { label: "Sales Orders", order: 344 }),
  objectRoute("/sales-orders/:id", "Sales order", "sales_orders"),
  serverOnlyRoute("/sales-orders/new", "New sales order", "A sales order is built from line items and prices on the server, so it needs a connection."),
  listRoute("/invoices", "Invoices", "invoices", { label: "Invoices", order: 346 }),
  objectRoute("/invoices/:id", "Invoice", "invoices"),
  serverOnlyRoute("/invoices/new", "New invoice", "An invoice is built from line items and taxes on the server, so it needs a connection."),
  serverOnlyRoute("/invoices/credit-notes", "Credit notes", "Credit notes are on the server, not on this laptop."),
  employeesRoute("/employees", "Employees", { label: "Employees", order: 350 }),
  employeesRoute("/hr", "HR", { label: "HR", order: 352 }),
  defineShellRoute({
    pattern: "/employees/:id", title: "Employee",
    load: () => import("../modules/EmployeeObjectScreen"),
    adapter: (shell, params) => loadEmployee(shell.data, params.id!),
  }),
  serverOnlyRoute("/employees/new", "New employee profile", "An employee profile is created on the server, so it needs a connection."),
];
