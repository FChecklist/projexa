"use client";

// Sumeet requirement #3 ("BILLING MILESTONES"). The real write UI for
// constructionProgressClaims's state machine (milestone_achieved -> drafted
// -> submitted -> client_approved -> invoiced, or rejected -> drafted) --
// Project360Client.tsx's tile only ever showed a read-only count, per this
// session's own audit finding.
//
// No delete anywhere: a rejected claim is redrafted, never removed, and a
// claim that reaches 'invoiced' is terminal but stays in the list forever --
// "ALL DATA WILL BE LOGGED AND NOT DELETED" per the Owner's own requirement,
// the same append-only discipline already used for milestones/change orders.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

export type ClaimStatus = "milestone_achieved" | "drafted" | "submitted" | "client_approved" | "invoiced" | "rejected";

export type Claim = {
  id: string;
  customerId: string;
  milestoneDescription: string;
  scheduledDate: string;
  retentionPercent: string;
  status: ClaimStatus;
  rejectionReason: string | null;
  interimBillId: string | null;
};

type Customer = { id: string; customerName: string };
type TaxTemplate = { id: string; name: string };
type TimelineStep = { stage: string; at: string | null; note?: string };
type Timeline = { steps: TimelineStep[]; isStuck: boolean; daysSinceLastStep: number };

const STATUS_LABEL: Record<ClaimStatus, string> = {
  milestone_achieved: "Milestone Achieved",
  drafted: "Drafted",
  submitted: "Submitted",
  client_approved: "Client Approved",
  invoiced: "Invoiced",
  rejected: "Rejected",
};

const STATUS_VARIANT: Record<ClaimStatus, "default" | "secondary" | "destructive" | "outline"> = {
  milestone_achieved: "outline",
  drafted: "outline",
  submitted: "secondary",
  client_approved: "secondary",
  invoiced: "default",
  rejected: "destructive",
};

export const NAME_REQUIRED = "Milestone description is required";
export const CUSTOMER_REQUIRED = "Customer is required";
// GAP FOUND (2026-09-19, Playwright gap-closure sweep): the backend route
// (POST /api/v1/projexa/billing-claims -> createProgressClaim) has always
// required scheduledDate -- confirmed live, a real 400 "scheduledDate is
// required" -- but this form's own client-side guard never checked for it,
// so a user who filled description+customer and left the date blank got a
// toast error with the form left open, instead of the same inline
// Save-button guidance NAME_REQUIRED/CUSTOMER_REQUIRED already give.
export const SCHEDULED_DATE_REQUIRED = "Scheduled date is required";
export const NO_APPROVED_BOQ_REASON = "This project has no approved BOQ yet -- a billing milestone needs one to bill against.";

/**
 * Pure, so the create form's wiring is verifiable without typing into a
 * controlled text input -- in this repo's test environment (React 19 +
 * happy-dom under bun test) fireEvent.change updates the DOM node but never
 * reaches React's onChange (same already-documented limitation
 * MilestonesClient.tsx's own buildMilestoneCreatePayload() works around).
 */
export function buildClaimCreatePayload(
  projectId: string,
  boqId: string,
  customerId: string,
  milestoneDescription: string,
  scheduledDate: string,
  retentionPercent: string
) {
  return {
    projectId,
    boqId,
    customerId,
    milestoneDescription: milestoneDescription.trim(),
    scheduledDate,
    retentionPercent: Number(retentionPercent) || 0,
  };
}

export default function BillingMilestonesClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  const [boqId, setBoqId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Record<string, Timeline>>({});

  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [retentionPercent, setRetentionPercent] = useState("0");

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [invoicingId, setInvoicingId] = useState<string | null>(null);
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [taxTemplateId, setTaxTemplateId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [claimsRes, customersRes, boqRes] = await Promise.all([
        fetchJson<{ claims?: Claim[] }>(`/api/billing-claims?projectId=${encodeURIComponent(projectId)}&all=true`),
        fetchJson<{ customers?: Customer[] }>("/api/customers"),
        fetchJson<{ row?: { boqId: string | null } }>(`/api/reports/boq-analysis?projectId=${encodeURIComponent(projectId)}`),
      ]);
      setClaims(claimsRes.claims ?? []);
      setCustomers(customersRes.customers ?? []);
      setBoqId(boqRes.row?.boqId ?? null);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load billing milestones"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    fetchJson<{ taxTemplates?: TaxTemplate[] }>("/api/tax-templates")
      .then((d) => setTaxTemplates(d.taxTemplates ?? []))
      .catch(() => setTaxTemplates([])); // ERP may not be enabled for this org -- invoicing simply stays unavailable, not a page-breaking error.
  }, []);

  function customerName(id: string): string {
    return customers.find((c) => c.id === id)?.customerName ?? id;
  }

  async function createClaim() {
    if (!milestoneDescription.trim() || !customerId || !boqId || !scheduledDate) return;
    setSaving(true);
    try {
      await fetchJson("/api/billing-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildClaimCreatePayload(projectId, boqId, customerId, milestoneDescription, scheduledDate, retentionPercent)),
      });
      toast.success("Billing milestone created");
      setMilestoneDescription(""); setCustomerId(""); setScheduledDate(""); setRetentionPercent("0");
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "The billing milestone was not created"));
    } finally {
      setSaving(false);
    }
  }

  async function transition(claimId: string, action: "draft" | "submit" | "approve" | "reject" | "invoice", extra: Record<string, unknown> = {}) {
    setBusyId(claimId);
    try {
      await fetchJson(`/api/billing-claims/${encodeURIComponent(claimId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      toast.success(`Billing milestone ${action === "draft" ? "drafted" : action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : "invoiced"}`);
      setRejectingId(null); setRejectionReason("");
      setInvoicingId(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update the billing milestone"));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTimeline(claimId: string) {
    if (expandedId === claimId) { setExpandedId(null); return; }
    setExpandedId(claimId);
    if (!timelines[claimId]) {
      try {
        const timeline = await fetchJson<Timeline>(`/api/billing-claims/${encodeURIComponent(claimId)}`);
        setTimelines((prev) => ({ ...prev, [claimId]: timeline }));
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load this milestone's timeline"));
      }
    }
  }

  const saveLabel = saving
    ? "Saving…"
    : !milestoneDescription.trim()
      ? `Save (${NAME_REQUIRED})`
      : !customerId
        ? `Save (${CUSTOMER_REQUIRED})`
        : !scheduledDate
          ? `Save (${SCHEDULED_DATE_REQUIRED})`
          : "Save";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!formOpen ? (
          <Button onClick={() => setFormOpen(true)} disabled={!boqId} title={!boqId ? NO_APPROVED_BOQ_REASON : undefined}>
            <Plus className="size-4" /> New Billing Milestone
          </Button>
        ) : null}
      </div>

      {formOpen && (
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="claim-customer">Customer</Label>
                <select
                  id="claim-customer"
                  className="h-9 w-56 rounded-md border border-px-border bg-transparent px-3 text-sm"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Select a customer…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.customerName}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claim-scheduled-date">Scheduled date</Label>
                <Input id="claim-scheduled-date" type="date" className="w-40" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claim-retention">Retention %</Label>
                <Input id="claim-retention" type="number" min={0} max={100} className="w-28" value={retentionPercent} onChange={(e) => setRetentionPercent(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-description">Milestone description</Label>
              <Textarea id="claim-description" value={milestoneDescription} onChange={(e) => setMilestoneDescription(e.target.value)} placeholder="e.g. Foundation complete, ready to bill" />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={createClaim}
                disabled={saving || !milestoneDescription.trim() || !customerId || !scheduledDate}
                title={!milestoneDescription.trim() ? NAME_REQUIRED : !customerId ? CUSTOMER_REQUIRED : !scheduledDate ? SCHEDULED_DATE_REQUIRED : undefined}
              >
                {saveLabel}
              </Button>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : claims.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No billing milestones yet.</p>
          ) : (
            <ul className="divide-y divide-px-border">
              {claims.map((c) => {
                const busy = busyId === c.id;
                return (
                  <li key={c.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[240px] space-y-0.5">
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-left font-medium underline-offset-2 hover:underline"
                          onClick={() => toggleTimeline(c.id)}
                        >
                          {expandedId === c.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          {c.milestoneDescription}
                        </button>
                        <div className="flex items-center gap-2">
                          <Badge variant={STATUS_VARIANT[c.status]} className="text-[10px]">{STATUS_LABEL[c.status]}</Badge>
                          <span className="text-xs text-px-muted">{customerName(c.customerId)} · Scheduled {c.scheduledDate}</span>
                        </div>
                        {c.status === "rejected" && c.rejectionReason && (
                          <p className="text-xs text-px-error">Rejected: {c.rejectionReason}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(c.status === "milestone_achieved" || c.status === "rejected") && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => transition(c.id, "draft")}>
                            {c.status === "rejected" ? "Redraft" : "Draft"}
                          </Button>
                        )}
                        {c.status === "drafted" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => transition(c.id, "submit")}>Submit</Button>
                        )}
                        {c.status === "submitted" && (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => transition(c.id, "approve")}>Approve</Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejectingId(rejectingId === c.id ? null : c.id)}>Reject</Button>
                          </>
                        )}
                        {c.status === "client_approved" && (
                          <Button
                            size="sm"
                            disabled={busy || taxTemplates.length === 0}
                            title={taxTemplates.length === 0 ? "No tax templates configured -- set one up in Accounting first" : undefined}
                            onClick={() => setInvoicingId(invoicingId === c.id ? null : c.id)}
                          >
                            Invoice
                          </Button>
                        )}
                        {c.status === "invoiced" && c.interimBillId && (
                          <Button size="sm" variant="ghost" onClick={() => router.push(`/invoices?highlight=${c.interimBillId}`)}>View invoice</Button>
                        )}
                      </div>
                    </div>

                    {rejectingId === c.id && (
                      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-px-border bg-px-cloud/40 p-3">
                        <div className="flex-1 space-y-1.5">
                          <Label htmlFor={`reject-reason-${c.id}`}>Reason</Label>
                          <Input id={`reject-reason-${c.id}`} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="e.g. Client disputes quantities" />
                        </div>
                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => transition(c.id, "reject", { rejectionReason })}>Confirm reject</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>Cancel</Button>
                      </div>
                    )}

                    {invoicingId === c.id && (
                      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-px-border bg-px-cloud/40 p-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`bill-date-${c.id}`}>Bill date</Label>
                          <Input id={`bill-date-${c.id}`} type="date" className="w-40" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`tax-template-${c.id}`}>Tax template</Label>
                          <select
                            id={`tax-template-${c.id}`}
                            className="h-9 w-48 rounded-md border border-px-border bg-transparent px-3 text-sm"
                            value={taxTemplateId}
                            onChange={(e) => setTaxTemplateId(e.target.value)}
                          >
                            <option value="">Select…</option>
                            {taxTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <Button size="sm" disabled={busy || !billDate || !taxTemplateId} onClick={() => transition(c.id, "invoice", { billDate, taxTemplateId })}>Confirm invoice</Button>
                        <Button size="sm" variant="ghost" onClick={() => setInvoicingId(null)}>Cancel</Button>
                      </div>
                    )}

                    {expandedId === c.id && (
                      <div className="mt-3 pl-5">
                        {!timelines[c.id] ? (
                          <Loader2 className="size-4 animate-spin text-px-muted" />
                        ) : (
                          <ul className="space-y-1 text-xs text-px-muted">
                            {timelines[c.id].steps.map((s) => (
                              <li key={s.stage}>
                                <span className="font-medium text-px-ink">{s.stage.replace(/_/g, " ")}</span>: {s.at ? formatDate(s.at) : "not yet"}
                                {s.note && ` — ${s.note}`}
                              </li>
                            ))}
                            {timelines[c.id].isStuck && <li className="text-px-error">No progress in {timelines[c.id].daysSinceLastStep} days -- follow up.</li>}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
