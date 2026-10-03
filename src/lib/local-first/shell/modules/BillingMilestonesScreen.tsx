"use client";

// LOCAL-FIRST shell, Billing Milestones (/billing-milestones): the project's progress claims from the laptop's own copy. Read-only:
// a claim is moved along (drafted, submitted, approved, rejected, invoiced) by the server, which decides approvals and works out the
// money. See billing-adapter.ts.

import { formatDate } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen, ServerOnly, StateMessage, projectName } from "./DeliveryParts";
import type { BillingData } from "./billing-adapter";

const STATUS_LABEL: Record<string, string> = {
  milestone_achieved: "Milestone Achieved",
  drafted: "Drafted",
  submitted: "Submitted",
  client_approved: "Client Approved",
  invoiced: "Invoiced",
  rejected: "Rejected",
};
const statusLabel = (status: string) => STATUS_LABEL[status] ?? status.replace(/_/g, " ");

export default function BillingMilestonesScreen({ shell, data }: ShellScreenProps<BillingData>) {
  if (data.state !== "local") return <StateMessage testId="billing" title="Billing Milestones" state={data.state} what="billing milestone list" />;
  const name = projectName(shell, data.projectId);
  return (
    <Screen testId="billing" state="local" title={`Billing Milestones${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="billing-copy-note" syncedAt={data.syncedAt} />
      <ServerOnly shell={shell} what="Creating a milestone, and drafting, submitting, approving, rejecting or invoicing one, is done on the server." path="/billing-milestones" />
      {!data.customerHidden && data.customerNames !== "local" && data.claims.length > 0 ? (
        <p className="mt-2 text-xs text-px-muted" data-testid="billing-customers-note">
          {data.customerNames === "not_allowed"
            ? "Customer names are not part of what your role keeps on this laptop."
            : "Customer names are not on this laptop yet. They arrive with the next sync."}
        </p>
      ) : null}
      {data.claims.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No billing milestones yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-black/10 rounded-lg border border-black/10 bg-white" data-testid="billing-list">
          {data.claims.map((c) => (
            <li key={c.id} className="p-4" data-testid="billing-row" data-status={c.status}>
              <p className="font-medium text-px-ink">{c.description}</p>
              <p className="mt-0.5 text-xs text-px-muted">
                <span className="mr-2 rounded border border-black/10 px-1.5 py-0.5 text-px-ink" data-testid="billing-status">{statusLabel(c.status)}</span>
                {data.customerHidden ? <span data-hidden="1">Customer hidden for your role</span> : (c.customerName ?? DASH)}
                {" · Scheduled "}{c.scheduledDate ? formatDate(c.scheduledDate) : DASH}
              </p>
              {c.status === "rejected" && c.rejectionReason ? <p className="mt-1 text-xs text-red-800">Rejected: {c.rejectionReason}</p> : null}
              {c.steps.length > 0 ? (
                <p className="mt-1 text-xs text-px-muted" data-testid="billing-steps">
                  {c.steps.map((s) => `${s.stage} ${formatDate(s.at)}`).join(" · ")}
                </p>
              ) : null}
              {c.interimBillId ? (
                <p className="mt-1 text-xs">
                  <a className="text-px-ink underline underline-offset-2" href={`/invoices?highlight=${encodeURIComponent(c.interimBillId)}`}>View invoice</a>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
