"use client";

// Priority 15: PROJEXA's GRC (Governance, Risk & Compliance) surface --
// 7 tabs over VERIDIAN's real GRC services (this codebase's own original,
// most mature module), sized for a ~100-employee firm running ~500
// projects: a risk register with likelihood x impact severity scoring, an
// audit/findings-with-remediation workflow, a policy library maker-checker
// lifecycle, vendor risk profiles, a fraud/incident case register with a
// real status lifecycle, an access-review certification cycle, and the
// existing compliance/statutory register. All data is real, fetched from
// VERIDIAN via PROJEXA's own thin proxy routes -- no mock/local state.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, ShieldAlert, ChevronRight } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
type Risk = { id: string; title: string; category: string; likelihood: number; impact: number; severity: string; status: string; ownerDept: string | null };
type GrcDashboard = {
  risks: { openCount: number; totalCount: number; byCategory: Record<string, number>; bySeverity: Record<string, number>; heatmap: { likelihood: number; impact: number; count: number }[] };
  audit: { engagementCount: number; openFindingsCount: number; overdueFindingsCount: number };
  policies: { totalCount: number; draftCount: number; underReviewCount: number; publishedCount: number };
  vendorRisk: { totalCount: number; highTierCount: number };
};
type AuditFinding = { id: string; title: string; severity: string; capaStatus: string; dueDate: string | null; retestResult: string | null };
type AuditEngagement = { id: string; name: string; auditType: string; status: string; findings: AuditFinding[] };
type Policy = { id: string; title: string; category: string; version: string; status: string; attestationRate: number };
type VendorRiskProfile = { id: string; name: string; riskTier: string; riskScore: number | null };
type FraudCase = { id: string; caseNumber: number; title: string; status: string; fraudType: string; financialExposure: string | null; reportedDate: string };
type AccessReviewCycle = { id: string; name: string; status: string; dueDate: string | null; completedAt: string | null };
type AccessReviewCertification = { id: string; userId: string; userName: string; userEmail: string | null; reviewedRole: string; decision: string };
type ComplianceItem = { id: string; title: string; complianceType: string; status: string; priority: string; dueDate: string; department: { name: string } };

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline", medium: "secondary", high: "destructive",
};
const RISK_STATUS_FLOW: Record<string, string> = { open: "mitigating", mitigating: "closed", closed: "closed" };

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------
function DashboardPanel() {
  const [data, setData] = useState<GrcDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/grc-dashboard");
        setData(await res.json());
      } catch {
        toast.error("Couldn't load GRC dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (!data) return <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t load the GRC dashboard.</p>;

  const maxHeat = Math.max(1, ...data.risks.heatmap.map((h) => h.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">Open Risks</p><p className="mt-1 text-2xl font-bold text-px-ink">{data.risks.openCount}</p><p className="text-xs text-px-muted">of {data.risks.totalCount} total</p></CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">Open Findings</p><p className="mt-1 text-2xl font-bold text-px-ink">{data.audit.openFindingsCount}</p><p className="text-xs text-red-600">{data.audit.overdueFindingsCount} overdue</p></CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">Policies Published</p><p className="mt-1 text-2xl font-bold text-px-ink">{data.policies.publishedCount}</p><p className="text-xs text-px-muted">{data.policies.underReviewCount} under review</p></CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">High-Risk Vendors</p><p className="mt-1 text-2xl font-bold text-px-ink">{data.vendorRisk.highTierCount}</p><p className="text-xs text-px-muted">of {data.vendorRisk.totalCount} tracked</p></CardContent></Card>
      </div>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Risk Heatmap (Likelihood x Impact)</CardTitle></CardHeader>
        <CardContent>
          {data.risks.heatmap.length === 0 ? (
            <p className="py-6 text-center text-sm text-px-muted">No open risks logged yet.</p>
          ) : (
            <div className="grid grid-cols-5 gap-1.5" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
              {Array.from({ length: 5 }, (_, i) => 5 - i).map((impact) => (
                <div key={impact} className="contents">
                  {Array.from({ length: 5 }, (_, j) => j + 1).map((likelihood) => {
                    const cell = data.risks.heatmap.find((h) => h.likelihood === likelihood && h.impact === impact);
                    const count = cell?.count ?? 0;
                    const intensity = count / maxHeat;
                    return (
                      <div
                        key={`${likelihood}-${impact}`}
                        className="flex aspect-square items-center justify-center rounded text-xs font-semibold"
                        style={{ backgroundColor: count === 0 ? "var(--muted)" : `rgba(220, 38, 38, ${0.15 + intensity * 0.65})`, color: intensity > 0.5 ? "white" : undefined }}
                        title={`Likelihood ${likelihood} x Impact ${impact}: ${count} risk(s)`}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-px-muted">Rows: impact 5 (top) to 1 (bottom). Columns: likelihood 1 to 5.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Risks by Category</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(data.risks.byCategory).length === 0 ? <p className="text-sm text-px-muted">No open risks.</p> : Object.entries(data.risks.byCategory).map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between text-sm"><span className="capitalize text-px-ink">{cat}</span><Badge variant="outline">{count}</Badge></div>
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Risks by Severity</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(data.risks.bySeverity).map(([sev, count]) => (
              <div key={sev} className="flex items-center justify-between text-sm"><span className="capitalize text-px-ink">{sev}</span><Badge variant={SEVERITY_VARIANT[sev] ?? "outline"}>{count}</Badge></div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Register tab
// ---------------------------------------------------------------------------
function RiskRegisterPanel() {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("operational");
  const [likelihood, setLikelihood] = useState("3");
  const [impact, setImpact] = useState("3");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/risks");
      const data = await res.json();
      setRisks(data.risks ?? []);
    } catch {
      toast.error("Couldn't load risk register");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createRisk() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/risks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, likelihood: Number(likelihood), impact: Number(impact) }),
      });
      if (!res.ok) throw new Error();
      toast.success("Risk logged");
      setTitle(""); setCategory("operational"); setLikelihood("3"); setImpact("3"); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create risk");
    } finally {
      setSubmitting(false);
    }
  }

  async function advanceStatus(risk: Risk) {
    const nextStatus = RISK_STATUS_FLOW[risk.status];
    if (nextStatus === risk.status) return;
    try {
      const res = await fetch(`/api/risks/${risk.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Risk moved to ${nextStatus}`);
      load();
    } catch {
      toast.error("Couldn't update risk status");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Log Risk</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log a Risk</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Key subcontractor delay on Site 4" /></div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["regulatory", "operational", "financial", "strategic", "reputational", "cyber"].map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Likelihood (1-5)</Label><Input type="number" min={1} max={5} value={likelihood} onChange={(e) => setLikelihood(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Impact (1-5)</Label><Input type="number" min={1} max={5} value={impact} onChange={(e) => setImpact(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={createRisk} disabled={submitting}>{submitting ? "Logging…" : "Log Risk"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : risks.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No risks logged yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Likelihood x Impact</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {risks.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="capitalize text-px-muted">{r.category}</TableCell>
                    <TableCell className="text-px-muted">{r.likelihood} x {r.impact} = {r.likelihood * r.impact}</TableCell>
                    <TableCell><Badge variant={SEVERITY_VARIANT[r.severity] ?? "outline"} className="capitalize">{r.severity}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{r.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {r.status !== "closed" && (
                        <Button variant="ghost" size="sm" onClick={() => advanceStatus(r)}>
                          Move to {RISK_STATUS_FLOW[r.status]} <ChevronRight className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audits & Findings tab
// ---------------------------------------------------------------------------
function AuditsPanel() {
  const [engagements, setEngagements] = useState<AuditEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [findingOpen, setFindingOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [auditType, setAuditType] = useState("internal");
  const [findingEngagementId, setFindingEngagementId] = useState("");
  const [findingTitle, setFindingTitle] = useState("");
  const [findingSeverity, setFindingSeverity] = useState("medium");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/audit-engagements");
      const data = await res.json();
      setEngagements(data.engagements ?? []);
    } catch {
      toast.error("Couldn't load audit engagements");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createEngagement() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/audit-engagements", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, auditType }),
      });
      if (!res.ok) throw new Error();
      toast.success("Audit engagement planned");
      setName(""); setAuditType("internal"); setEngagementOpen(false);
      load();
    } catch {
      toast.error("Couldn't create audit engagement");
    } finally {
      setSubmitting(false);
    }
  }

  async function createFinding() {
    if (!findingEngagementId || !findingTitle.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/audit-findings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditEngagementId: findingEngagementId, title: findingTitle, severity: findingSeverity }),
      });
      if (!res.ok) throw new Error();
      toast.success("Finding recorded");
      setFindingEngagementId(""); setFindingTitle(""); setFindingSeverity("medium"); setFindingOpen(false);
      load();
    } catch {
      toast.error("Couldn't record finding");
    } finally {
      setSubmitting(false);
    }
  }

  async function advanceCapa(findingId: string) {
    try {
      const res = await fetch(`/api/audit-findings/${findingId}`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      toast.success("CAPA status advanced");
      load();
    } catch {
      toast.error("Couldn't advance CAPA status");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Dialog open={findingOpen} onOpenChange={setFindingOpen}>
          <DialogTrigger asChild><Button variant="outline" size="sm">Record Finding</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record a Finding</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Audit Engagement</Label>
                <Select value={findingEngagementId} onValueChange={setFindingEngagementId}>
                  <SelectTrigger><SelectValue placeholder={engagements.length ? "Select an engagement" : "Plan an engagement first"} /></SelectTrigger>
                  <SelectContent>{engagements.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Finding Title</Label><Input value={findingTitle} onChange={(e) => setFindingTitle(e.target.value)} placeholder="e.g. Missing fire-exit signage on Floor 3" /></div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select value={findingSeverity} onValueChange={setFindingSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "medium", "high", "critical"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={createFinding} disabled={submitting}>{submitting ? "Recording…" : "Record Finding"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={engagementOpen} onOpenChange={setEngagementOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Plan Audit</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Plan an Audit Engagement</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Site Safety Audit" /></div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={auditType} onValueChange={setAuditType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["internal", "certification", "statutory"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={createEngagement} disabled={submitting}>{submitting ? "Planning…" : "Plan Audit"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : engagements.length === 0 ? (
        <p className="py-10 text-center text-sm text-px-muted">No audit engagements planned yet.</p>
      ) : (
        <div className="space-y-3">
          {engagements.map((e) => (
            <Card key={e.id} className="shadow-card">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{e.name}</CardTitle>
                  <p className="text-xs capitalize text-px-muted">{e.auditType} audit &middot; {e.status}</p>
                </div>
                <Badge variant="outline">{e.findings.length} finding{e.findings.length === 1 ? "" : "s"}</Badge>
              </CardHeader>
              {e.findings.length > 0 && (
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Severity</TableHead><TableHead>CAPA Status</TableHead><TableHead>Due</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {e.findings.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell>{f.title}</TableCell>
                          <TableCell><Badge variant={SEVERITY_VARIANT[f.severity] ?? "outline"} className="capitalize">{f.severity}</Badge></TableCell>
                          <TableCell><Badge variant={f.capaStatus === "closed" ? "default" : "outline"} className="capitalize">{f.capaStatus.replace("_", " ")}</Badge></TableCell>
                          <TableCell className="text-px-muted">{f.dueDate ? new Date(f.dueDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-right">
                            {f.capaStatus !== "closed" && <Button variant="ghost" size="sm" onClick={() => advanceCapa(f.id)}>Advance CAPA <ChevronRight className="size-3.5" /></Button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policies tab
// ---------------------------------------------------------------------------
function PoliciesPanel() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("governance");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/policies");
      const data = await res.json();
      setPolicies(data.policies ?? []);
    } catch {
      toast.error("Couldn't load policies");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createPolicy() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/policies", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, category }),
      });
      if (!res.ok) throw new Error();
      toast.success("Policy drafted");
      setTitle(""); setCategory("governance"); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't draft policy");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestPublish(id: string) {
    try {
      const res = await fetch(`/api/policies/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_publish" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Publish requested — awaiting approval");
      load();
    } catch {
      toast.error("Couldn't request publish");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Draft Policy</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Draft a Policy</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Site Safety & PPE Policy" /></div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["governance", "hr", "environment", "data_privacy", "third_party", "sop"].map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={createPolicy} disabled={submitting}>{submitting ? "Drafting…" : "Draft Policy"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : policies.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No policies drafted yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Attestation</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell className="capitalize text-px-muted">{p.category.replace("_", " ")}</TableCell>
                    <TableCell className="text-px-muted">{p.version}</TableCell>
                    <TableCell><Badge variant={p.status === "published" ? "default" : "outline"} className="capitalize">{p.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-px-muted">{p.attestationRate}%</TableCell>
                    <TableCell className="text-right">
                      {p.status === "draft" && <Button variant="ghost" size="sm" onClick={() => requestPublish(p.id)}>Request Publish</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Risk tab
// ---------------------------------------------------------------------------
function VendorRiskPanel() {
  const [vendors, setVendors] = useState<VendorRiskProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [riskTier, setRiskTier] = useState("medium");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor-risk");
      const data = await res.json();
      setVendors(data.vendors ?? []);
    } catch {
      toast.error("Couldn't load vendor risk profiles");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createVendor() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/vendor-risk", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, riskTier }),
      });
      if (!res.ok) throw new Error();
      toast.success("Vendor added for risk tracking");
      setName(""); setRiskTier("medium"); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't add vendor");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Add Vendor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Vendor for Risk Tracking</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Vendor Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Risk Tier</Label>
                <Select value={riskTier} onValueChange={setRiskTier}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "medium", "high"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={createVendor} disabled={submitting}>{submitting ? "Adding…" : "Add Vendor"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : vendors.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No vendors under risk tracking yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Risk Tier</TableHead><TableHead>Risk Score</TableHead></TableRow></TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell><Badge variant={v.riskTier === "high" ? "destructive" : v.riskTier === "medium" ? "secondary" : "outline"} className="capitalize">{v.riskTier}</Badge></TableCell>
                    <TableCell className="text-px-muted">{v.riskScore ?? "Not yet assessed"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fraud / Incident Cases tab
// ---------------------------------------------------------------------------
const FRAUD_TRANSITIONS: Record<string, string[]> = {
  reported: ["investigating"], investigating: ["confirmed", "unsubstantiated"], confirmed: ["resolved"], unsubstantiated: ["resolved"], resolved: [],
};

function FraudCasesPanel() {
  const currencies = useCurrencies();
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [fraudType, setFraudType] = useState("other");
  const [reportedDate, setReportedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/fraud-cases");
      const data = await res.json();
      setCases(data.cases ?? []);
    } catch {
      toast.error("Couldn't load fraud/incident cases");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createCase() {
    if (!title.trim() || !reportedDate) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/fraud-cases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, fraudType, reportedDate, description: description || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Case logged");
      setTitle(""); setFraudType("other"); setDescription(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't log case");
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(caseId: string, status: string) {
    try {
      const res = await fetch(`/api/fraud-cases/${caseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Case moved to ${status}`);
      load();
    } catch {
      toast.error("Couldn't update case status");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Log Case</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log a Fraud / Incident Case</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Duplicate vendor invoice, Site 7" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={fraudType} onValueChange={setFraudType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["procurement", "payroll", "expense", "vendor_collusion", "asset_misappropriation", "other"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Reported Date</Label><Input type="date" value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label>Description (optional)</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
            </div>
            <DialogFooter><Button onClick={createCase} disabled={submitting}>{submitting ? "Logging…" : "Log Case"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : cases.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No cases logged yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Exposure</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-px-muted">{c.caseNumber}</TableCell>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell className="capitalize text-px-muted">{c.fraudType.replace("_", " ")}</TableCell>
                    <TableCell className="text-px-muted">{c.financialExposure ? `${currencyLabel(undefined, currencies)}${Number(c.financialExposure).toLocaleString("en-US")}` : "—"}</TableCell>
                    <TableCell><Badge variant={c.status === "resolved" ? "default" : c.status === "confirmed" ? "destructive" : "outline"} className="capitalize">{c.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      {(FRAUD_TRANSITIONS[c.status] ?? []).map((next) => (
                        <Button key={next} variant="ghost" size="sm" onClick={() => transition(c.id, next)} className="capitalize">{next.replace("_", " ")}</Button>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access Review tab
// ---------------------------------------------------------------------------
function AccessReviewPanel() {
  const [cycles, setCycles] = useState<AccessReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [certifications, setCertifications] = useState<AccessReviewCertification[]>([]);
  const [certLoading, setCertLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/access-review");
      const data = await res.json();
      setCycles(data.cycles ?? []);
    } catch {
      toast.error("Couldn't load access review cycles");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function openCycle() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/access-review", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      toast.success("Access review cycle opened");
      setName(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't open access review cycle");
    } finally {
      setSubmitting(false);
    }
  }

  async function viewCycle(cycleId: string) {
    setSelectedCycleId(cycleId);
    setCertLoading(true);
    try {
      const res = await fetch(`/api/access-review?cycleId=${cycleId}`);
      const data = await res.json();
      setCertifications(data.cycle?.certifications ?? []);
    } catch {
      toast.error("Couldn't load cycle certifications");
    } finally {
      setCertLoading(false);
    }
  }

  async function decide(certId: string, decision: "confirmed" | "revoked") {
    try {
      const res = await fetch(`/api/access-review/certifications/${certId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Certification ${decision}`);
      if (selectedCycleId) viewCycle(selectedCycleId);
    } catch {
      toast.error("Couldn't record decision");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Open Cycle</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Open an Access Review Cycle</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-px-muted">Snapshots every active team member&apos;s current role for confirm/revoke review.</p>
              <div className="space-y-1.5"><Label>Cycle Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 2026 Access Certification" /></div>
            </div>
            <DialogFooter><Button onClick={openCycle} disabled={submitting}>{submitting ? "Opening…" : "Open Cycle"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : cycles.length === 0 ? (
        <p className="py-10 text-center text-sm text-px-muted">No access review cycles opened yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="shadow-card">
            <CardContent className="p-2">
              {cycles.map((c) => (
                <button
                  key={c.id}
                  onClick={() => viewCycle(c.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedCycleId === c.id ? "bg-px-orange/10 text-px-ink" : "hover:bg-muted"}`}
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs capitalize text-px-muted">{c.status}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardContent className="p-0">
              {!selectedCycleId ? (
                <p className="py-10 text-center text-sm text-px-muted">Select a cycle to review certifications.</p>
              ) : certLoading ? (
                <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Decision</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {certifications.map((cert) => (
                      <TableRow key={cert.id}>
                        <TableCell>{cert.userName}</TableCell>
                        <TableCell className="capitalize text-px-muted">{cert.reviewedRole}</TableCell>
                        <TableCell><Badge variant={cert.decision === "confirmed" ? "default" : cert.decision === "revoked" ? "destructive" : "outline"} className="capitalize">{cert.decision}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          {cert.decision === "pending" && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => decide(cert.id, "confirmed")}>Confirm</Button>
                              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => decide(cert.id, "revoked")}>Revoke</Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance Register tab (statutory/regulatory obligations calendar)
// ---------------------------------------------------------------------------
function ComplianceRegisterPanel() {
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/compliance-register?${params.toString()}`);
      const data = await res.json();
      setItems(data.register ?? []);
    } catch {
      toast.error("Couldn't load compliance register");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search obligations…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="max-w-xs" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["pending", "in_progress", "completed", "overdue", "not_applicable"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}>Search</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No compliance obligations found.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Department</TableHead><TableHead>Due Date</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.title}</TableCell>
                    <TableCell className="text-px-muted">{i.complianceType}</TableCell>
                    <TableCell className="text-px-muted">{i.department?.name ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{i.dueDate ? new Date(i.dueDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{i.priority}</Badge></TableCell>
                    <TableCell><Badge variant={i.status === "completed" ? "default" : i.status === "overdue" ? "destructive" : "outline"} className="capitalize">{i.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root client
// ---------------------------------------------------------------------------
export default function GrcClient() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-px-muted">
        <ShieldAlert className="size-4" />
        <span>Real GRC data from VERIDIAN AI OS — risk register, audits, policies, vendor risk, fraud cases, access review, and statutory obligations.</span>
      </div>
      <Tabs defaultValue="dashboard">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="risks">Risk Register</TabsTrigger>
          <TabsTrigger value="audits">Audits &amp; Findings</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="vendor-risk">Vendor Risk</TabsTrigger>
          <TabsTrigger value="fraud">Fraud &amp; Incidents</TabsTrigger>
          <TabsTrigger value="access-review">Access Review</TabsTrigger>
          <TabsTrigger value="compliance">Compliance Register</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><DashboardPanel /></TabsContent>
        <TabsContent value="risks"><RiskRegisterPanel /></TabsContent>
        <TabsContent value="audits"><AuditsPanel /></TabsContent>
        <TabsContent value="policies"><PoliciesPanel /></TabsContent>
        <TabsContent value="vendor-risk"><VendorRiskPanel /></TabsContent>
        <TabsContent value="fraud"><FraudCasesPanel /></TabsContent>
        <TabsContent value="access-review"><AccessReviewPanel /></TabsContent>
        <TabsContent value="compliance"><ComplianceRegisterPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
