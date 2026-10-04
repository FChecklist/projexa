// LOCAL-FIRST shell, group "finance, sales, HR": the one tolerant row reader the three adapters of this group share
// (expenses-adapter.ts, billing-adapter.ts, customers-adapter.ts). Replica rows are UNTRUSTED input: a row is only used when it is
// a plain object with a non-empty string id; every field is read through the delivery cluster's tolerant readers (snake_case or
// camelCase spelling, Postgres numeric text accepted, anything else null -- never a 0 standing in for "unknown").
//
// WHAT THIS GROUP CAN DRAW OFFLINE, AND WHAT IT CANNOT (the sync service's kinds are the whole answer; see
// compliance-tracker supabase/functions/projexa-sync/handler.ts SYNC_KINDS and ORG_KINDS):
//   expenses, billing-milestones  -> project kinds `expenses` and `progress_claims`                    (drawn here)
//   customers                     -> organisation kind `customers` (role rank >= 2)                    (drawn here)
//   accounting, budgets, finance, invoices, payroll, proposals, quotations, sales, sales-orders, hr, employees, recruitment,
//   copilot                       -> NO kind: the journal, ledgers, fiscal-year budgets, sales invoices, quotations, sales orders, leads,
//                                    payroll runs, HR employees, recruitment and the AI proposals inbox are not in the sync service.
//                                    Nothing is drawn for them (no fabricated data); the shell's own "not on this laptop yet" answer applies.

import { str } from "./delivery-local";

export { bool, day, field, num, readKind, str } from "./delivery-local";

export type Obj = Record<string, unknown>;

/** A row as an object when it is one and has a non-empty string id; null otherwise. */
export function rowWithId(raw: unknown): (Obj & { id: string }) | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Obj;
  return typeof o.id === "string" && o.id.length > 0 ? (o as Obj & { id: string }) : null;
}

/** A non-empty text field, trimmed of nothing (shown as stored), or null. */
export function text(o: Obj, snake: string): string | null {
  const v = str(o, snake);
  return v !== null && v.trim() !== "" ? v : null;
}

/** Whether the sync hid a column from this person's role (the done marker's own list: the only authority; a row's value is never trusted over it). */
export const isHidden = (hidden: readonly string[], column: string): boolean => hidden.includes(column);
