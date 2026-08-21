"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Play, Share2 } from "lucide-react";

type LineItemRow = {
  lineItemId: string; code: string; description: string; categoryName: string; unit: string; rate: number;
  qtyTotal: number; amtTotal: number;
  qty: { prev: number; current: number; total: number };
  amt: { prev: number; current: number; total: number };
  percentage: { prev: number; current: number; total: number };
};
type CategoryRow = { name: string; amtTotal: number; amt: { prev: number; current: number; total: number }; percentage: { prev: number; current: number; total: number } };
type ManpowerRow = { trade: string; workerDays: number; totalCost: number };
type VendorRow = { vendorId: string; vendorName: string; totalCost: number };

type ReportResponse = { boqTitle: string | null; rows: LineItemRow[]; byCategory: CategoryRow[]; byManpower: ManpowerRow[]; byVendor: VendorRow[] };

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// The real, Owner-supplied column shape: S.No | Category | Code | Description |
// Qty[Unit | Rate | Amt] | Amt[Prev | Current | Total] | Percentage[Prev |
// Current | Total]. Reused for both the scope-wise (one row per BoQ line
// item) and category-wise (rolled-up) views -- same columns, different
// grouping, matching the report's own spec.
function ScopeTable({ rows }: { rows: LineItemRow[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No BoQ line items for this project yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>S.No</TableHead><TableHead>Category</TableHead><TableHead>Code</TableHead><TableHead>Description</TableHead>
          <TableHead>Unit</TableHead><TableHead>Rate</TableHead><TableHead>Amt</TableHead>
          <TableHead>Amt Prev</TableHead><TableHead>Amt Current</TableHead><TableHead>Amt Total</TableHead>
          <TableHead>% Prev</TableHead><TableHead>% Current</TableHead><TableHead>% Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.lineItemId}>
            <TableCell>{i + 1}</TableCell><TableCell>{r.categoryName}</TableCell>
            <TableCell className="font-mono text-xs">{r.code || "—"}</TableCell><TableCell>{r.description}</TableCell>
            <TableCell>{r.unit}</TableCell><TableCell>{money(r.rate)}</TableCell><TableCell>{money(r.amtTotal)}</TableCell>
            <TableCell>{money(r.amt.prev)}</TableCell><TableCell>{money(r.amt.current)}</TableCell><TableCell>{money(r.amt.total)}</TableCell>
            <TableCell>{r.percentage.prev}%</TableCell><TableCell>{r.percentage.current}%</TableCell><TableCell>{r.percentage.total}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CategoryTable({ rows }: { rows: CategoryRow[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">Nothing to break down by category yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead><TableHead>Amt Total</TableHead>
          <TableHead>Amt Prev</TableHead><TableHead>Amt Current</TableHead><TableHead>Amt Total (to date)</TableHead>
          <TableHead>% Prev</TableHead><TableHead>% Current</TableHead><TableHead>% Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell>{r.name}</TableCell><TableCell>{money(r.amtTotal)}</TableCell>
            <TableCell>{money(r.amt.prev)}</TableCell><TableCell>{money(r.amt.current)}</TableCell><TableCell>{money(r.amt.total)}</TableCell>
            <TableCell>{r.percentage.prev}%</TableCell><TableCell>{r.percentage.current}%</TableCell><TableCell>{r.percentage.total}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ManpowerTable({ rows }: { rows: ManpowerRow[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No attendance recorded in this date range.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Trade</TableHead><TableHead>Worker-Days</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.trade}><TableCell>{r.trade}</TableCell><TableCell>{r.workerDays}</TableCell><TableCell>{money(r.totalCost)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VendorTable({ rows }: { rows: VendorRow[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No vendor-linked labour cost in this date range.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.vendorId}><TableCell>{r.vendorName}</TableCell><TableCell>{money(r.totalCost)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function defaultFrom() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function WorkProgressReportClient({ projectId }: { projectId: string }) {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [sharing, setSharing] = useState(false);

  async function runReport() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId, from, to });
      const res = await fetch(`/api/work-progress/report?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setReport(data);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't generate the report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  // Point 118: a plain, expiring, read-only link -- NOT the WhatsApp
  // Business API (explicitly ruled out). Copies the URL so the user can
  // paste it into WhatsApp themselves.
  async function shareReport() {
    setSharing(true);
    try {
      const res = await fetch("/api/work-progress/report/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      await navigator.clipboard.writeText(data.url);
      toast.success(`Share link copied — expires ${new Date(data.expiresAt).toLocaleDateString()}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create a share link");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={runReport} disabled={loading} data-testid="work-progress-report-run">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run Report
          </Button>
          {report && (
            <Button onClick={shareReport} disabled={sharing} variant="outline">
              {sharing ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />} Share
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-4">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : !report ? (
            <p className="py-10 text-center text-sm text-px-muted">Pick a date range and click Run Report.</p>
          ) : (
            <Tabs defaultValue="scope" className="space-y-4">
              <TabsList>
                <TabsTrigger value="scope">Scope-wise</TabsTrigger>
                <TabsTrigger value="category">Category-wise</TabsTrigger>
                <TabsTrigger value="manpower">Manpower-wise</TabsTrigger>
                <TabsTrigger value="vendor">Vendor-wise</TabsTrigger>
              </TabsList>
              <TabsContent value="scope"><ScopeTable rows={report.rows} /></TabsContent>
              <TabsContent value="category"><CategoryTable rows={report.byCategory} /></TabsContent>
              <TabsContent value="manpower"><ManpowerTable rows={report.byManpower} /></TabsContent>
              <TabsContent value="vendor"><VendorTable rows={report.byVendor} /></TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
