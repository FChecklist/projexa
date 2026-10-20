"use client";

// LOCAL-FIRST shell, Billing Milestones (/billing-milestones): the project's progress claims from the laptop's own copy. A NEW milestone can
// be made with no network (BillingNewScreen: a draft until a person with the billing role confirms it online, billing-writes.ts); moving a
// claim along (drafted, submitted, approved, rejected, invoiced) stays with the server, which decides approvals and works out the money.
// See billing-adapter.ts.

import { formatDate } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import ClaimInvoiceAction from "@/components/ClaimInvoiceAction";
import { CopyNote, DASH, Screen, ServerOnly, StateMessage, mayWrite, projectName, withProject } from "./DeliveryParts";
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
      <p className="mt-3 text-sm" data-testid="billing-new-link">
        <a className="text-px-ink underline underline-offset-2" href={withProject("/billing-milestones/new", data.projectId)}>New billing milestone</a>
        {" — it works with no network and stays a draft until a person with the billing role confirms it online."}
      </p>
      <ServerOnly shell={shell} what="Drafting, submitting, approving or rejecting a milestone is done on the server, by a person. An approved milestone can be invoiced from here while you are connected; no money is posted from the laptop." path="/billing-milestones" />
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
                {c.waiting ? <span className="mr-2 rounded bg-px-concrete px-1.5 py-0.5 text-px-muted" data-testid="billing-waiting">Waiting to sync</span> : null}
                {c.status === "milestone_achieved" ? <span className="mr-2 text-px-muted" data-testid="billing-draft">Draft until confirmed</span> : null}
                {data.customerHidden ? <span data-hidden="1">Customer hidden for your role</span> : (c.customerName ?? DASH)}
                {" · Scheduled "}{c.scheduledDate ? formatDate(c.scheduledDate) : DASH}
              </p>
              {c.status === "rejected" && c.rejectionReason ? <p className="mt-1 text-xs text-red-800">Rejected: {c.rejectionReason}</p> : null}
              {c.steps.length > 0 ? (
                <p className="mt-1 text-xs text-px-muted" data-testid="billing-steps">
                  {c.steps.map((s) => `${s.stage} ${formatDate(s.at)}`).join(" · ")}
                </p>
              ) : null}
              {c.status === "client_approved" && !c.waiting && mayWrite(shell) ? (
                <div className="mt-2" data-testid="billing-invoice-action">
                  {shell.connectivity === "online" ? (
                    <ClaimInvoiceAction claimId={c.id} onInvoiced={() => shell.refresh()} />
                  ) : (
                    <p className="text-xs text-px-muted" data-testid="billing-invoice-offline">Invoicing needs a connection. It will be offered here when you are connected.</p>
                  )}
                </div>
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
