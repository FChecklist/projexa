"use client";

// R46 P8 seq134: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list (see PermitsListClient.tsx's header comment
// for the full history). This screen never adopted the kit's ListScreen
// component -- it's a plain shadcn Table with a bespoke, live e-signature
// Actions column (SignatureStatusCell below) that has no registry
// equivalent -- so only the 5 real data columns (#/Title/Cost Impact/
// Schedule Impact/Status) are registry-driven: COLUMNS is now the fallback
// used when change-orders/page.tsx's server-side resolve of the
// variations.list screen_definitions row returns null (404/error), same
// "keep the hardcoded version behind a flag until verified" contract as
// permits. Actions stays hardcoded outside the columns map, always.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField, type FieldErrors, hasErrors } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";

type ChangeOrder = {
  id: string; number: number; title: string; reason: string | null; costImpact: string; scheduleImpactDays: number; status: string;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "#", field: "number", type: "text", importance: "High" },
  { label: "Title", field: "title", type: "text", importance: "High" },
  { label: "Cost Impact", field: "costImpact", type: "number", importance: "High" },
  { label: "Schedule Impact", field: "scheduleImpactDays", type: "number", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
];

type SignatureStatus = {
  signatureRequest: {
    id: string; status: string; title: string; completedAt: string | null;
    signers: { name: string; email: string; status: string; signOrder: number | null; signedAt: string | null; declinedAt: string | null; declineReason: string | null }[];
  } | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "default", rejected: "destructive",
};

// Per-field cell renderer -- this screen isn't built on the kit's ListScreen
// (its Actions column needs the live SignatureStatusCell below, which has no
// registry equivalent), so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 5 columns live (the hard-stop test); the actual cell
// value for each known field is still this project's own formatting logic,
// looked up by field name so reordering doesn't change what renders.
function renderChangeOrderCell(field: string, c: ChangeOrder, formatCurrency: (n: number) => string) {
  switch (field) {
    case "number":
      return <span className="font-mono text-xs">CO-{c.number}</span>;
    case "title":
      return <span className="font-medium">{c.title}</span>;
    case "costImpact":
      return (
        <span className={Number(c.costImpact) >= 0 ? "text-px-error" : "text-px-success"}>
          {formatCurrency(Number(c.costImpact))}
        </span>
      );
    case "scheduleImpactDays":
      return (
        <span className="text-px-muted">
          {c.scheduleImpactDays > 0 ? `+${c.scheduleImpactDays}d` : c.scheduleImpactDays === 0 ? "—" : `${c.scheduleImpactDays}d`}
        </span>
      );
    case "status":
      return <Badge variant={STATUS_VARIANT[c.status]}>{c.status.replace(/_/g, " ")}</Badge>;
    default:
      return String((c as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

// Real, honest signature-progress summary for a pending_approval change
// order -- deliberately NOT a one-click approve/reject button. A naive
// button here would let any team member flip a change order to "approved"
// regardless of whether the actual external signer signed anything,
// defeating the entire point of using e-signature instead of a status flag
// (PROJEXA_GAP_ANALYSIS.md gap #5). The real approval mechanism is
// VERIDIAN's e-signature completion path (esignature-service.ts), which now
// auto-transitions the change order's own status once every signer has
// signed (or rejects it if a signer declines) -- this cell only reports
// that real progress, it never causes it.
function SignatureStatusCell({ data, loading }: { data: SignatureStatus | undefined; loading: boolean }) {
  if (loading) return <span className="text-xs text-px-muted">Checking signature status…</span>;
  if (!data || !data.signatureRequest) {
    return <span className="text-xs text-px-muted">No signature request created yet</span>;
  }
  const { signers, status } = data.signatureRequest;
  const signedCount = signers.filter((s) => s.status === "signed").length;
  const declined = signers.find((s) => s.status === "declined");
  if (status === "declined" || declined) {
    return (
      <span className="text-xs text-px-error">
        Declined by {declined?.name ?? "a signer"}{declined?.declineReason ? ` — "${declined.declineReason}"` : ""}
      </span>
    );
  }
  if (status === "voided") return <span className="text-xs text-px-muted">Signature request voided</span>;
  return (
    <span className="text-xs text-px-muted" title={signers.map((s) => `${s.name} (${s.email}): ${s.status}`).join(", ")}>
      Awaiting signature ({signedCount} of {signers.length} signed)
    </span>
  );
}

export default function ChangeOrdersClient({ projectId, registryColumns }: { projectId: string; registryColumns?: RegistryColumn[] | null }) {
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was Intl.NumberFormat(..., { currency: "INR" })
  // -- forced both symbol and grouping to India regardless of the org's real
  // base currency. Closure over `currencies` so every existing
  // formatCurrency(...) call site below is unchanged.
  const formatCurrency = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [items, setItems] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [signatureStatuses, setSignatureStatuses] = useState<Record<string, SignatureStatus>>({});
  const [signatureStatusLoading, setSignatureStatusLoading] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // R52 F_008: per-field validation messages, replacing two bare `return`s.
  const [createErrors, setCreateErrors] = useState<FieldErrors<"title" | "costImpact" | "scheduleImpactDays">>({});
  const [signerErrors, setSignerErrors] = useState<FieldErrors<"signerName" | "signerEmail">>({});
  const [submittingId, setSubmittingId] = useState<ChangeOrder | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/change-orders?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      const changeOrders: ChangeOrder[] = data.changeOrders ?? [];
      setItems(changeOrders);
      // Only pending_approval rows have anything to show here -- draft has
      // no signature request yet, approved/rejected already have their
      // final Badge, no need to spend a request on those.
      const pending = changeOrders.filter((c) => c.status === "pending_approval");
      setSignatureStatusLoading(Object.fromEntries(pending.map((c) => [c.id, true])));
      await Promise.all(pending.map(async (c) => {
        try {
          const sRes = await fetch(`/api/change-orders/${c.id}/signature-status`);
          const sData = await sRes.json();
          setSignatureStatuses((prev) => ({ ...prev, [c.id]: sData }));
        } catch {
          // Leave this row's entry unset -- SignatureStatusCell already
          // renders an honest "No signature request created yet" fallback
          // for undefined, no separate error state needed for one row.
        } finally {
          setSignatureStatusLoading((prev) => ({ ...prev, [c.id]: false }));
        }
      }));
    } catch {
      toast.error("Couldn't load change orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createChangeOrder() {
    // R52 fix for F_008's other half. The recorded fault is the missing
    // htmlFor/id pairing (fixed in the markup below), but the same dialog also
    // failed silently: `if (!title.trim()) return;` -- the same silent-no-op
    // shape recorded separately as F_002 on /materials. Fixed together because
    // they are one defect seen from two sides.
    const errors: FieldErrors<"title" | "costImpact" | "scheduleImpactDays"> = {};
    if (!title.trim()) errors.title = "Title is required.";
    if (costImpact.trim() && Number.isNaN(Number(costImpact))) errors.costImpact = "Cost impact must be a number.";
    if (scheduleImpactDays.trim() && Number.isNaN(Number(scheduleImpactDays))) errors.scheduleImpactDays = "Schedule impact must be a number of days.";
    setCreateErrors(errors);
    if (hasErrors(errors)) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/change-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title, reason: reason || undefined,
          costImpact: costImpact ? Number(costImpact) : 0,
          scheduleImpactDays: scheduleImpactDays ? Number(scheduleImpactDays) : 0,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Change order created");
      setTitle(""); setReason(""); setCostImpact(""); setScheduleImpactDays(""); setCreateErrors({}); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create change order");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitForApproval() {
    if (!submittingId) return;
    const errors: FieldErrors<"signerName" | "signerEmail"> = {};
    if (!signerName.trim()) errors.signerName = "Signer name is required.";
    if (!signerEmail.trim()) errors.signerEmail = "Signer email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail.trim())) errors.signerEmail = `"${signerEmail.trim()}" is not a valid email address.`;
    setSignerErrors(errors);
    if (hasErrors(errors)) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/change-orders/${submittingId.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", signers: [{ name: signerName, email: signerEmail }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Sent for e-signature approval");
      setSubmittingId(null); setSignerName(""); setSignerEmail("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit for approval");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Change Order</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Change Order</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <FormField label="Title" required error={createErrors.title}>
                {(f) => <Input {...f} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </FormField>
              <FormField label="Reason (optional)">
                {(f) => <Textarea {...f} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />}
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label={`Cost Impact (${currencyLabel(undefined, currencies).trim()})`} error={createErrors.costImpact}>
                  {(f) => <Input {...f} type="number" value={costImpact} onChange={(e) => setCostImpact(e.target.value)} placeholder="+/- amount" />}
                </FormField>
                <FormField label="Schedule Impact (days)" error={createErrors.scheduleImpactDays}>
                  {(f) => <Input {...f} type="number" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} placeholder="+/- days" />}
                </FormField>
              </div>
            </div>
            <DialogFooter><Button onClick={createChangeOrder} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No change orders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderChangeOrderCell(col.field, c, formatCurrency)}</TableCell>
                    ))}
                    <TableCell className="text-right">
                      {c.status === "draft" && <Button size="sm" variant="outline" onClick={() => setSubmittingId(c)}>Send for Approval</Button>}
                      {c.status === "pending_approval" && (
                        <SignatureStatusCell data={signatureStatuses[c.id]} loading={!!signatureStatusLoading[c.id]} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!submittingId} onOpenChange={(v) => !v && setSubmittingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send for E-Signature Approval</DialogTitle></DialogHeader>
          <p className="text-sm text-px-muted">Real signing request, tamper-evident audit trail (same workflow used for contracts).</p>
          <div className="space-y-3">
            <FormField label="Signer name" required error={signerErrors.signerName}>
              {(f) => <Input {...f} value={signerName} onChange={(e) => setSignerName(e.target.value)} />}
            </FormField>
            <FormField label="Signer email" required error={signerErrors.signerEmail}>
              {(f) => <Input {...f} type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />}
            </FormField>
          </div>
          <DialogFooter><Button onClick={submitForApproval} disabled={submitting}>{submitting ? "Sending…" : "Send"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
