// LOCAL-FIRST shell, Expenses (/expenses), read from the laptop's own database.
//
// THE ONLINE SCREEN (src/app/(app)/expenses, ExpensesClient): "Total logged", then a table of Date, Head, Description, Amount, newest
// first as the server lists them; "Log Expense" opens /expenses/new.
//
// WHAT THE LAPTOP HAS. Project kind `expenses` (id, expense_head, expense_date, is_rework, recorded_by_id, created_at, amount,
// description). `amount` and `description` are MONEY columns of the kind (a description can quote the amount): the sync service sends
// them as null below the role that may see cost and names them in the pull's hidden fields (kept in the done marker). A hidden
// column is shown as "Hidden for your role" and its value is dropped here even if a row carries one.
//
// NOT DONE HERE, ON PURPOSE.
//  * "Total logged": the online screen adds the amounts up in the browser. Money is never worked out on the laptop, so this screen
//    shows how many expenses there are and each amount as the server recorded it -- never a sum. (A partly copied list would also
//    give a wrong sum; the list here is only ever a complete copy.)
//  * Logging an expense: there is no registered server function to send it through (the outbox only sends registered AI work link
//    functions), so the screen says so and opens the server's own form when online. Nothing is kept on the laptop that the server
//    has not been asked about.

import type { ShellData } from "../context";
import { bool, day, isHidden, num, readKind, rowWithId, text, type Obj } from "./finance-local";

export type Expense = {
  id: string;
  head: string;
  date: string;
  description: string | null;
  amount: number | null;
  isRework: boolean;
};

export type ExpensesData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; expenses: Expense[]; amountHidden: boolean; descriptionHidden: boolean; syncedAt: number };

function parseExpense(raw: unknown): Expense | null {
  const o: (Obj & { id: string }) | null = rowWithId(raw);
  if (!o) return null;
  const head = text(o, "expense_head");
  const date = day(o, "expense_date");
  if (!head || !date) return null;
  return { id: o.id, head, date, description: text(o, "description"), amount: num(o, "amount"), isRework: bool(o, "is_rework") === true };
}

export async function loadExpenses(data: ShellData, projectId: string | null): Promise<ExpensesData> {
  if (!projectId) return { state: "no_project" };
  const read = await readKind(data, projectId, "expenses", parseExpense);
  if (!read.synced) return { state: "not_synced", projectId };
  const amountHidden = isHidden(read.hidden, "amount");
  const descriptionHidden = isHidden(read.hidden, "description");
  const expenses = read.rows
    .map((e) => ({ ...e, amount: amountHidden ? null : e.amount, description: descriptionHidden ? null : e.description }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { state: "local", projectId, expenses, amountHidden, descriptionHidden, syncedAt: read.syncedAt };
}
