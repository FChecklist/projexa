"use client";

// Real-screen conversion (2026-08-30): replaces VendorsClient.tsx's old
// "New Vendor" Dialog-only surface (no detail view existed at all -- not
// even clickable rows) with a real Object Page. erp-vendor-master-service.ts
// has carried a real Vendor Master feature set since Wave 80 -- banking
// details, a qualification review workflow, sanction/blacklist screening,
// a self-service vendor portal -- with ZERO route or UI consumer until this
// conversion (confirmed via a repo-wide search before writing any of this).
// getSupplier() also didn't exist (erp-buying-service.ts had list/create/
// update, never a single-item read).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ban } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate, formatDateTime } from "@/lib/format-date";

type Vendor = {
  id: string; vendorName: string; vendorType: string | null; gst: string | null; pan: string | null;
  trade: string | null; projectId: string | null; defaultPaymentTermsDays: number | null;
  creditLimit: string | null; isActive: boolean;
  qualificationStatus: string; sanctionScreeningStatus: string; sanctionScreenedAt: string | null;
};
type QualificationReview = { id: string; status: string; score: string | null; notes: string | null; createdAt: string };
type SanctionCheck = { id: string; listsChecked: string[]; matchFound: boolean; matchDetails: string | null; resultStatus: string; createdAt: string };
type BankAccount = { id: string; accountHolderName: string; bankName: string; accountNumberMasked: string; ifscCode: string | null; accountType: string; isPrimary: boolean };
type PortalLink = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string };

export default function VendorObjectClient({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const { isIndiaOrg } = useOrgRole();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [reviews, setReviews] = useState<QualificationReview[]>([]);
  const [checks, setChecks] = useState<SanctionCheck[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [links, setLinks] = useState<PortalLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ vendorName: "", vendorType: "", trade: "", gst: "", pan: "", defaultPaymentTermsDays: "", creditLimit: "" });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [qStatus, setQStatus] = useState<"in_review" | "qualified" | "rejected">("in_review");
  const [qScore, setQScore] = useState(""); const [qNotes, setQNotes] = useState("");
  const [sLists, setSLists] = useState(""); const [sMatch, setSMatch] = useState(false);
  const [sResult, setSResult] = useState<"clear" | "flagged" | "blocked">("clear"); const [sDetails, setSDetails] = useState("");
  const [bHolder, setBHolder] = useState(""); const [bBank, setBBank] = useState(""); const [bAccount, setBAccount] = useState("");
  const [bIfsc, setBIfsc] = useState(""); const [bType, setBType] = useState("savings"); const [bPrimary, setBPrimary] = useState(false);

  async function load() {
    try {
      const [v, r, c, a, l] = await Promise.all([
        fetchJson<Vendor>(`/api/vendors/${vendorId}`),
        fetchJson<{ reviews?: QualificationReview[] }>(`/api/vendors/${vendorId}/qualification`).catch(() => ({ reviews: [] })),
        fetchJson<{ checks?: SanctionCheck[] }>(`/api/vendors/${vendorId}/sanction-checks`).catch(() => ({ checks: [] })),
        fetchJson<{ bankAccounts?: BankAccount[] }>(`/api/vendors/${vendorId}/bank-accounts`).catch(() => ({ bankAccounts: [] })),
        fetchJson<{ links?: PortalLink[] }>(`/api/vendors/${vendorId}/portal-links`).catch(() => ({ links: [] })),
      ]);
      setVendor(v);
      setReviews(r.reviews ?? []); setChecks(c.checks ?? []); setAccounts(a.bankAccounts ?? []); setLinks(l.links ?? []);
      setLoadError(null);
    } catch (err) {
      setVendor(null);
      setLoadError(errorMessage(err, "Couldn't load this vendor"));
    }
  }
  useEffect(() => { load(); }, [vendorId]);

  function startEdit() {
    if (!vendor) return;
    setDraft({
      vendorName: vendor.vendorName, vendorType: vendor.vendorType ?? "", trade: vendor.trade ?? "",
      gst: vendor.gst ?? "", pan: vendor.pan ?? "",
      defaultPaymentTermsDays: vendor.defaultPaymentTermsDays != null ? String(vendor.defaultPaymentTermsDays) : "",
      creditLimit: vendor.creditLimit ?? "",
    });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.vendorName.trim()) { toast.error("Vendor name is required"); return; }
    setSaving(true);
    try {
      await fetchJson(`/api/vendors/${vendorId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: draft.vendorName.trim(), vendorType: draft.vendorType || undefined, trade: draft.trade || undefined,
          gst: draft.gst || undefined, pan: draft.pan || undefined,
          defaultPaymentTermsDays: draft.defaultPaymentTermsDays ? Number(draft.defaultPaymentTermsDays) : undefined,
          creditLimit: draft.creditLimit ? Number(draft.creditLimit) : undefined,
        }),
      });
      toast.success("Vendor saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save vendor"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!vendor) return;
    setBusy("active");
    try {
      await fetchJson(`/api/vendors/${vendorId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !vendor.isActive }),
      });
      toast.success(vendor.isActive ? "Vendor deactivated" : "Vendor activated");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update vendor status"));
    } finally {
      setBusy(null);
    }
  }

  async function recordQualification() {
    setBusy("qualification");
    try {
      await fetchJson(`/api/vendors/${vendorId}/qualification`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: qStatus, score: qScore ? Number(qScore) : undefined, notes: qNotes || undefined }),
      });
      toast.success("Qualification review recorded");
      setQScore(""); setQNotes("");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record qualification review"));
    } finally {
      setBusy(null);
    }
  }

  async function recordSanctionCheck() {
    if (!sLists.trim()) { toast.error("List at least one list checked (e.g. \"OFAC SDN\")"); return; }
    setBusy("sanction");
    try {
      await fetchJson(`/api/vendors/${vendorId}/sanction-checks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listsChecked: sLists.split(",").map((s) => s.trim()).filter(Boolean),
          matchFound: sMatch, resultStatus: sResult, matchDetails: sDetails || undefined,
        }),
      });
      toast.success("Sanction check recorded");
      setSLists(""); setSMatch(false); setSDetails("");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record sanction check"));
    } finally {
      setBusy(null);
    }
  }

  async function addBankAccount() {
    if (!bHolder.trim() || !bBank.trim() || bAccount.trim().length < 4) { toast.error("Account holder, bank name, and a valid account number are required"); return; }
    setBusy("bank");
    try {
      await fetchJson(`/api/vendors/${vendorId}/bank-accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHolderName: bHolder.trim(), bankName: bBank.trim(), accountNumber: bAccount.trim(), ifscCode: bIfsc || undefined, accountType: bType, isPrimary: bPrimary }),
      });
      toast.success("Bank account added");
      setBHolder(""); setBBank(""); setBAccount(""); setBIfsc(""); setBPrimary(false);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add bank account"));
    } finally {
      setBusy(null);
    }
  }

  async function createPortalLink() {
    setBusy("portal");
    try {
      await fetchJson(`/api/vendors/${vendorId}/portal-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      toast.success("Portal link created");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create portal link"));
    } finally {
      setBusy(null);
    }
  }

  async function revokePortalLink(linkId: string) {
    setBusy(`revoke-${linkId}`);
    try {
      await fetchJson(`/api/vendors/${vendorId}/portal-links/${linkId}`, { method: "DELETE" });
      toast.success("Portal link revoked");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't revoke portal link"));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!vendor) return <p className="p-6 text-[13px] text-px-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Vendors / Vendor"
      title={mode === "edit" ? "Edit Vendor" : vendor.vendorName}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: vendor.isActive ? "done" : "neutral", label: vendor.isActive ? "active" : "inactive" }}
      facets={[
        { label: "Type", value: vendor.vendorType ?? "—" },
        { label: "Trade", value: vendor.trade ?? "—" },
        { label: "Payment Terms", value: vendor.defaultPaymentTermsDays != null ? `${vendor.defaultPaymentTermsDays} days` : "—" },
        { label: "Credit Limit", value: vendor.creditLimit ?? "—" },
        { label: "Qualification", value: vendor.qualificationStatus.replace(/_/g, " ") },
        { label: "Sanction Screening", value: vendor.sanctionScreeningStatus.replace(/_/g, " ") },
      ]}
      onEdit={mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onBack={() => router.push("/vendors")}
      saveDisabled={saving || !draft.vendorName.trim()}
      saveDisabledReason={saving ? "Saving…" : !draft.vendorName.trim() ? "Vendor name is required" : undefined}
      messages={[]}
    >
      {mode === "display" && (
        <div className="flex items-center gap-2 border-b border-px-border px-4 py-3">
          <Button size="sm" variant="outline" disabled={busy === "active"} onClick={toggleActive}>
            {busy === "active" ? "Saving…" : vendor.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      )}

      {mode === "edit" ? (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>Vendor Name</Label><Input value={draft.vendorName} onChange={(e) => setDraft((d) => ({ ...d, vendorName: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Type</Label><Input value={draft.vendorType} onChange={(e) => setDraft((d) => ({ ...d, vendorType: e.target.value }))} placeholder="e.g. Subcontractor" /></div>
            <div className="space-y-1.5"><Label>Trade</Label><Input value={draft.trade} onChange={(e) => setDraft((d) => ({ ...d, trade: e.target.value }))} placeholder="e.g. Electrical" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {isIndiaOrg && <div className="space-y-1.5"><Label>GST</Label><Input value={draft.gst} onChange={(e) => setDraft((d) => ({ ...d, gst: e.target.value }))} /></div>}
            {isIndiaOrg && <div className="space-y-1.5"><Label>PAN</Label><Input value={draft.pan} onChange={(e) => setDraft((d) => ({ ...d, pan: e.target.value }))} /></div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Payment Terms (days)</Label><Input type="number" value={draft.defaultPaymentTermsDays} onChange={(e) => setDraft((d) => ({ ...d, defaultPaymentTermsDays: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Credit Limit</Label><Input type="number" value={draft.creditLimit} onChange={(e) => setDraft((d) => ({ ...d, creditLimit: e.target.value }))} /></div>
          </div>
        </div>
      ) : (
        <div className="space-y-5 px-4 py-3">
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-px-navy">Qualification</h4>
            {reviews.length === 0 ? <p className="text-sm text-px-muted">No reviews recorded yet.</p> : (
              <ul className="mb-2 space-y-1 text-sm">
                {reviews.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-md border border-px-border px-2 py-1.5">
                    <span className="flex items-center gap-2"><Badge variant={r.status === "qualified" ? "default" : "outline"}>{r.status.replace(/_/g, " ")}</Badge>{r.notes && <span className="text-px-muted">{r.notes}</span>}</span>
                    <span className="text-xs text-px-muted">{r.score ? `Score ${r.score} · ` : ""}{formatDate(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={qStatus} onValueChange={(v) => setQStatus(v as typeof qStatus)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="in_review">In Review</SelectItem><SelectItem value="qualified">Qualified</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Score (optional)</Label><Input type="number" className="w-24" value={qScore} onChange={(e) => setQScore(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Notes (optional)</Label><Input className="w-56" value={qNotes} onChange={(e) => setQNotes(e.target.value)} /></div>
              <Button size="sm" disabled={busy === "qualification"} onClick={recordQualification}>{busy === "qualification" ? "Saving…" : "Record Review"}</Button>
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-px-navy">Sanction Screening</h4>
            <p className="mb-1 text-xs text-px-muted">No live sanctions-list API is connected here — this logs the outcome of a check a human performed against an external list.</p>
            {checks.length === 0 ? <p className="text-sm text-px-muted">No checks recorded yet.</p> : (
              <ul className="mb-2 space-y-1 text-sm">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-md border border-px-border px-2 py-1.5">
                    <span className="flex items-center gap-2"><Badge variant={c.resultStatus === "clear" ? "default" : "outline"}>{c.resultStatus}</Badge><span className="text-px-muted">{c.listsChecked.join(", ")}</span></span>
                    <span className="text-xs text-px-muted">{formatDate(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label>Lists Checked (comma-separated)</Label><Input className="w-56" value={sLists} onChange={(e) => setSLists(e.target.value)} placeholder="OFAC SDN, UN Consolidated List" /></div>
              <div className="space-y-1.5">
                <Label>Result</Label>
                <Select value={sResult} onValueChange={(v) => setSResult(v as typeof sResult)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="clear">Clear</SelectItem><SelectItem value="flagged">Flagged</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5 pb-1.5"><Checkbox checked={sMatch} onCheckedChange={(v) => setSMatch(!!v)} /><Label className="font-normal">Match found</Label></div>
              {sMatch && <div className="space-y-1.5"><Label>Match Details</Label><Input className="w-56" value={sDetails} onChange={(e) => setSDetails(e.target.value)} /></div>}
              <Button size="sm" disabled={busy === "sanction"} onClick={recordSanctionCheck}>{busy === "sanction" ? "Saving…" : "Record Check"}</Button>
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-px-navy">Bank Accounts</h4>
            {accounts.length === 0 ? <p className="text-sm text-px-muted">No bank accounts on file.</p> : (
              <ul className="mb-2 space-y-1 text-sm">
                {accounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md border border-px-border px-2 py-1.5">
                    <span>{a.accountHolderName} · {a.bankName} · {a.accountNumberMasked}</span>
                    {a.isPrimary && <Badge>primary</Badge>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label>Account Holder</Label><Input className="w-40" value={bHolder} onChange={(e) => setBHolder(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Bank Name</Label><Input className="w-40" value={bBank} onChange={(e) => setBBank(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Account Number</Label><Input className="w-40" value={bAccount} onChange={(e) => setBAccount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>IFSC (optional)</Label><Input className="w-32" value={bIfsc} onChange={(e) => setBIfsc(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={bType} onValueChange={setBType}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="savings">Savings</SelectItem><SelectItem value="current">Current</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5 pb-1.5"><Checkbox checked={bPrimary} onCheckedChange={(v) => setBPrimary(!!v)} /><Label className="font-normal">Primary</Label></div>
              <Button size="sm" disabled={busy === "bank"} onClick={addBankAccount}>{busy === "bank" ? "Saving…" : "Add Account"}</Button>
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-px-navy">Self-Service Portal Links</h4>
            {links.length === 0 ? <p className="text-sm text-px-muted">No portal links created yet.</p> : (
              <ul className="mb-2 space-y-1 text-sm">
                {links.map((l) => {
                  const revoked = !!l.revokedAt;
                  const expired = !revoked && new Date(l.expiresAt) < new Date();
                  return (
                    <li key={l.id} className="flex items-center justify-between rounded-md border border-px-border px-2 py-1.5">
                      <span className="font-mono text-xs">{l.token.slice(0, 12)}…</span>
                      <span className="flex items-center gap-2">
                        <Badge variant={revoked || expired ? "outline" : "default"}>{revoked ? "revoked" : expired ? "expired" : "active"}</Badge>
                        <span className="text-xs text-px-muted">expires {formatDateTime(l.expiresAt)}</span>
                        {!revoked && !expired && (
                          <Button size="sm" variant="ghost" disabled={busy === `revoke-${l.id}`} onClick={() => revokePortalLink(l.id)}><Ban className="size-3.5" /> Revoke</Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button size="sm" variant="outline" disabled={busy === "portal"} onClick={createPortalLink}>{busy === "portal" ? "Creating…" : "Create Portal Link"}</Button>
          </div>
        </div>
      )}
    </ObjectScreen>
  );
}
