// LOCAL-FIRST shell, Billing Milestones (/billing-milestones), read from the laptop's own database.
//
// THE ONLINE SCREEN (BillingMilestonesClient): a list of progress claims -- milestone, status badge, customer, scheduled date, a
// rejection reason -- with the buttons that move a claim along (draft, submit, approve, reject, invoice) and "New Billing Milestone".
//
// WHAT THE LAPTOP HAS. Project kind `progress_claims` (id, boq_id, milestone_description, scheduled_date, status, drafted_at,
// submitted_at, approved_at, rejected_at, rejection_reason, invoiced_at, retention_percent, customer_id, interim_bill_id). The three
// last columns are MONEY columns of the kind: null below the role that may see cost, named in the done marker's hidden fields. The
// customer's name is read from the organisation kind `customers` (customers-adapter.ts) -- only when this role may see the
// customer at all (customer_id not hidden) and the organisation kind is on the laptop.
//
// READ-ONLY, ON PURPOSE. A claim's status is a state machine the SERVER owns: approving, rejecting and invoicing are approvals and
// invoicing computes money (gross, retention, tax). None of that is decided or kept as a guess on the laptop; the screen lists the
// claims and says that moving one along is done on the server, with a link when online. The step dates below are the ones the
// server recorded (drafted/submitted/approved/rejected/invoiced), not computed here.

import type { ShellData } from "../context";
import { loadOrgLocal } from "../../org-local";
import { day, isHidden, readKind, rowWithId, str, text, type Obj } from "./finance-local";

export type ClaimStep = { stage: "Drafted" | "Submitted" | "Approved" | "Rejected" | "Invoiced"; at: string };

export type Claim = {
  id: string;
  description: string;
  status: string;
  scheduledDate: string | null;
  rejectionReason: string | null;
  customerName: string | null;
  interimBillId: string | null;
  steps: ClaimStep[];
};

export type CustomerNames = "local" | "not_allowed" | "not_synced";

export type BillingData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | {
      state: "local";
      projectId: string;
      claims: Claim[];
      /** The role may not see who a claim is billed to (customer_id is hidden): the screen says so rather than a dash. */
      customerHidden: boolean;
      /** Whether customer names could be looked up on this laptop (the organisation kind), for the calm sentence when they could not. */
      customerNames: CustomerNames;
      syncedAt: number;
    };

const STEP_COLUMNS = [
  ["drafted_at", "Drafted"],
  ["submitted_at", "Submitted"],
  ["approved_at", "Approved"],
  ["rejected_at", "Rejected"],
  ["invoiced_at", "Invoiced"],
] as const;

type RawClaim = Omit<Claim, "customerName"> & { customerId: string | null };

function parseClaim(raw: unknown): RawClaim | null {
  const o: (Obj & { id: string }) | null = rowWithId(raw);
  if (!o) return null;
  const description = text(o, "milestone_description");
  const status = text(o, "status");
  if (!description || !status) return null;
  const steps: ClaimStep[] = [];
  for (const [column, stage] of STEP_COLUMNS) {
    const at = str(o, column);
    if (at && at.trim() !== "") steps.push({ stage, at });
  }
  return {
    id: o.id, description, status, scheduledDate: day(o, "scheduled_date"), rejectionReason: text(o, "rejection_reason"),
    customerId: text(o, "customer_id"), interimBillId: text(o, "interim_bill_id"), steps,
  };
}

export async function loadBilling(data: ShellData, projectId: string | null): Promise<BillingData> {
  if (!projectId) return { state: "no_project" };
  const read = await readKind(data, projectId, "progress_claims", parseClaim);
  if (!read.synced) return { state: "not_synced", projectId };
  const customerHidden = isHidden(read.hidden, "customer_id");
  const billHidden = isHidden(read.hidden, "interim_bill_id");

  const org = await loadOrgLocal("customers", { userId: data.userId, idb: data.idb });
  const names = new Map<string, string>();
  if (org.state === "local") {
    for (const row of org.rows) {
      const name = typeof row.customer_name === "string" && row.customer_name.trim() !== "" ? row.customer_name : null;
      if (name) names.set(row.id, name);
    }
  }

  const claims: Claim[] = read.rows
    .map((c) => ({
      id: c.id, description: c.description, status: c.status, scheduledDate: c.scheduledDate, rejectionReason: c.rejectionReason, steps: c.steps,
      // a hidden column never prints its value, even one a row carries
      customerName: customerHidden || !c.customerId ? null : names.get(c.customerId) ?? null,
      interimBillId: billHidden ? null : c.interimBillId,
    }))
    .sort((a, b) => (b.scheduledDate ?? "").localeCompare(a.scheduledDate ?? "") || a.id.localeCompare(b.id));
  return { state: "local", projectId, claims, customerHidden, customerNames: org.state === "local" ? "local" : org.state, syncedAt: read.syncedAt };
}
