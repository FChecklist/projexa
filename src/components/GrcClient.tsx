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
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, ShieldAlert, ChevronRight } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { formatDate } from "@/lib/format-date";

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
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // This used to be setData(await res.json()), which stored the ERROR
        // BODY as the dashboard on a non-2xx: `!data` was then false and the
        // panel rendered against undefined fields instead of reporting it.
        setData(await fetchJson<GrcDashboard>("/api/grc-dashboard"));
        setLoadError(null);
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load GRC dashboard"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (!data)
    return loadError ? (
      // The backend's own words, not a dead-end generic line.
      <DataLoadError messages={[loadError]} onRetry={() => window.location.reload()} />
    ) : (
      <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t load the GRC dashboard.</p>
    );

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
  const router = useRouter();
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Status read before body. The previous `await res.json()` never
      // looked at the HTTP status, so an error body parsed cleanly, the
      // `?? []` produced an empty array, and a failing backend rendered
      // as a confident "nothing here" empty state.
      const data = await fetchJson<{ risks?: Risk[] }>("/api/risks");
      setRisks(data.risks ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load risk register"));
      setRisks([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function advanceStatus(risk: Risk) {
    const nextStatus = RISK_STATUS_FLOW[risk.status];
    if (nextStatus === risk.status) return;
    try {
      await fetchJson(`/api/risks/${risk.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }),
      });
      toast.success(`Risk moved to ${nextStatus}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update risk status"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "Log
            Risk" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/grc/risks/new")}><Plus className="size-4" /> Log Risk</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
          ) : risks.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No risks logged yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Likelihood x Impact</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows now open the
                    real Object Page (no detail view existed before this). */}
                {risks.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/grc/risks/${r.id}`)}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="capitalize text-px-muted">{r.category}</TableCell>
                    <TableCell className="text-px-muted">{r.likelihood} x {r.impact} = {r.likelihood * r.impact}</TableCell>
                    <TableCell><Badge variant={SEVERITY_VARIANT[r.severity] ?? "outline"} className="capitalize">{r.severity}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{r.status}</Badge></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
  const router = useRouter();
  const [engagements, setEngagements] = useState<AuditEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Status read before body. The previous `await res.json()` never
      // looked at the HTTP status, so an error body parsed cleanly, the
      // `?? []` produced an empty array, and a failing backend rendered
      // as a confident "nothing here" empty state.
      const data = await fetchJson<{ engagements?: AuditEngagement[] }>("/api/audit-engagements");
      setEngagements(data.engagements ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load audit engagements"));
      setEngagements([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function advanceCapa(findingId: string) {
    try {
      await fetchJson(`/api/audit-findings/${findingId}`, { method: "PATCH" });
      toast.success("CAPA status advanced");
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't advance CAPA status"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        {/* Real screen navigation (2026-08-30) -- replaces the old "Record
            Finding"/"Plan Audit" Dialog popups with real create routes. */}
        <Button variant="outline" size="sm" onClick={() => router.push("/grc/findings/new")}>Record Finding</Button>
        <Button size="sm" onClick={() => router.push("/grc/audits/new")}><Plus className="size-4" /> Plan Audit</Button>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : loadError ? (
        <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
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
                          <TableCell className="text-px-muted">{f.dueDate ? formatDate(f.dueDate) : "—"}</TableCell>
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
  const router = useRouter();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Status read before body. The previous `await res.json()` never
      // looked at the HTTP status, so an error body parsed cleanly, the
      // `?? []` produced an empty array, and a failing backend rendered
      // as a confident "nothing here" empty state.
      const data = await fetchJson<{ policies?: Policy[] }>("/api/policies");
      setPolicies(data.policies ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load policies"));
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function requestPublish(id: string) {
    try {
      await fetchJson(`/api/policies/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_publish" }),
      });
      toast.success("Publish requested — awaiting approval");
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't request publish"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "Draft
            Policy" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/grc/policies/new")}><Plus className="size-4" /> Draft Policy</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
          ) : policies.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No policies drafted yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Attestation</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows now open the
                    real Object Page, which also exposes the real "edit"
                    (version bump) action that had zero UI before this. */}
                {policies.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/grc/policies/${p.id}`)}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell className="capitalize text-px-muted">{p.category.replace("_", " ")}</TableCell>
                    <TableCell className="text-px-muted">{p.version}</TableCell>
                    <TableCell><Badge variant={p.status === "published" ? "default" : "outline"} className="capitalize">{p.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-px-muted">{p.attestationRate}%</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorRiskProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Status read before body. The previous `await res.json()` never
      // looked at the HTTP status, so an error body parsed cleanly, the
      // `?? []` produced an empty array, and a failing backend rendered
      // as a confident "nothing here" empty state.
      const data = await fetchJson<{ vendors?: VendorRiskProfile[] }>("/api/vendor-risk");
      setVendors(data.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load vendor risk profiles"));
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "Add
            Vendor" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/grc/vendors/new")}><Plus className="size-4" /> Add Vendor</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
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
  const router = useRouter();
  const currencies = useCurrencies();
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Status read before body. The previous `await res.json()` never
      // looked at the HTTP status, so an error body parsed cleanly, the
      // `?? []` produced an empty array, and a failing backend rendered
      // as a confident "nothing here" empty state.
      const data = await fetchJson<{ cases?: FraudCase[] }>("/api/fraud-cases");
      setCases(data.cases ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load fraud/incident cases"));
      setCases([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function transition(caseId: string, status: string) {
    try {
      await fetchJson(`/api/fraud-cases/${caseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      toast.success(`Case moved to ${status}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update case status"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "Log
            Case" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/grc/cases/new")}><Plus className="size-4" /> Log Case</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
          ) : cases.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No cases logged yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Exposure</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows now open the
                    real Object Page (description/exposure/investigator were
                    write-only before this). */}
                {cases.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/grc/cases/${c.id}`)}>
                    <TableCell className="text-px-muted">{c.caseNumber}</TableCell>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell className="capitalize text-px-muted">{c.fraudType.replace("_", " ")}</TableCell>
                    <TableCell className="text-px-muted">{c.financialExposure ? `${currencyLabel(undefined, currencies)}${Number(c.financialExposure).toLocaleString("en-US")}` : "—"}</TableCell>
                    <TableCell><Badge variant={c.status === "resolved" ? "default" : c.status === "confirmed" ? "destructive" : "outline"} className="capitalize">{c.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
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
  const router = useRouter();
  const [cycles, setCycles] = useState<AccessReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Status read before body. The previous `await res.json()` never
      // looked at the HTTP status, so an error body parsed cleanly, the
      // `?? []` produced an empty array, and a failing backend rendered
      // as a confident "nothing here" empty state.
      const data = await fetchJson<{ cycles?: AccessReviewCycle[] }>("/api/access-review");
      setCycles(data.cycles ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load access review cycles"));
      setCycles([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "Open
            Cycle" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/grc/access-review/new")}><Plus className="size-4" /> Open Cycle</Button>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : loadError ? (
        <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
      ) : cycles.length === 0 ? (
        <p className="py-10 text-center text-sm text-px-muted">No access review cycles opened yet.</p>
      ) : (
        // Real screen navigation (2026-08-30) -- replaces the old in-tab
        // master-detail state (click a cycle in a list, no URL) with a real
        // routed Object Page.
        <Card className="shadow-card">
          <CardContent className="p-2">
            {cycles.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/grc/access-review/${c.id}`)}
                className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-xs capitalize text-px-muted">{c.status}</div>
              </button>
            ))}
          </CardContent>
        </Card>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      // Status read before body. The previous `await res.json()` never
      // looked at the HTTP status, so an error body parsed cleanly, the
      // `?? []` produced an empty array, and a failing backend rendered
      // as a confident "nothing here" empty state.
      const data = await fetchJson<{ register?: ComplianceItem[] }>(`/api/compliance-register?${params.toString()}`);
      setItems(data.register ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load compliance register"));
      setItems([]);
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
          ) : loadError ? (
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
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
                    <TableCell className="text-px-muted">{i.dueDate ? formatDate(i.dueDate) : "—"}</TableCell>
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
const GRC_VALID_TABS = new Set(["dashboard", "risks", "audits", "policies", "vendor-risk", "fraud", "access-review", "compliance"]);

export default function GrcClient({ initialTab }: { initialTab?: string }) {
  // Real-screen conversion (2026-08-30): the tab used to be internal-only
  // state (Tabs' own uncontrolled `defaultValue`) -- the new Risk/Policy/
  // Case/Vendor/Audit/AccessReview create screens redirect back here with
  // `?tab=`, so the URL needs to actually drive which tab renders. Mirrors
  // AccountingClient.tsx's/EmployeesClient.tsx's own fix for the identical gap.
  const [activeTab, setActiveTabState] = useState(initialTab && GRC_VALID_TABS.has(initialTab) ? initialTab : "dashboard");
  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-px-muted">
        <ShieldAlert className="size-4" />
        <span>Real GRC data from VERIDIAN AI OS — risk register, audits, policies, vendor risk, fraud cases, access review, and statutory obligations.</span>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
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
