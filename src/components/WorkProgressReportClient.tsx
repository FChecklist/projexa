"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play, Share2 } from "lucide-react";

// Point 11 (Rajat, 21 Aug: "SHOW BOTH TOTAL AND BALANCE, USER CHOOSES"):
// the third column of every band can read either total (previous +
// current) or balance (original - total) -- both legitimate, neither
// persisted, chosen here in component state only.
export type ThirdColumnMode = "total" | "balance";

export type LineItemRow = {
  lineItemId: string; code: string; description: string; categoryName: string; unit: string; rate: number;
  qtyTotal: number; amtTotal: number;
  // Point 108: which line this is a hierarchical BOQ child of, if any --
  // WPR-06 says percentages are PARENT-only, so this decides whether the
  // percent band renders blank for this row (a child) or real numbers
  // (a parent -- including a childless standalone line, which is a parent
  // of nothing but still not anyone's own child).
  parentLineItemId: string | null;
  qty: { prev: number; current: number; total: number; balance: number };
  amt: { prev: number; current: number; total: number; balance: number };
  percentage: { prev: number; current: number; total: number; balance: number };
};
type CategoryRow = { name: string; amtTotal: number; amt: { prev: number; current: number; total: number; balance: number }; percentage: { prev: number; current: number; total: number; balance: number } };
type ManpowerRow = { trade: string; workerDays: number; totalCost: number };
type VendorRow = { vendorId: string; vendorName: string; totalCost: number };

type ReportResponse = { boqTitle: string | null; rows: LineItemRow[]; byCategory: CategoryRow[]; byManpower: ManpowerRow[]; byVendor: VendorRow[] };

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Point 108 (Rajat, 21 Aug: "FOLLOW THE XLSX ORDER, not the handwritten
// page" -- the xlsx is the EXECUTED artefact, what his team actually fills
// in): S.No | Category | Code | Description | Unit | Rate | Amt (identifying
// columns, unchanged), then THREE bands in XLSX order -- Percent, then
// Quantity, then Amount -- each Previous | Current | Total-or-Balance
// (point 11's toggle), visually separated so a reader sees three groups,
// not nine undifferentiated columns. WPR-06: percentages are PARENT rows
// only -- a row with a parentLineItemId (a hierarchical BOQ child) renders
// blank percent cells, not 0.00 and not a number.
const bandBorder = "border-l-2 border-px-border";

export function ScopeTable({ rows, mode }: { rows: LineItemRow[]; mode: ThirdColumnMode }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No BoQ line items for this project yet.</p>;
  const thirdLabel = mode === "balance" ? "Balance" : "Total";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead rowSpan={2}>S.No</TableHead><TableHead rowSpan={2}>Category</TableHead>
          <TableHead rowSpan={2}>Code</TableHead><TableHead rowSpan={2}>Description</TableHead>
          <TableHead rowSpan={2}>Unit</TableHead><TableHead rowSpan={2}>Rate</TableHead><TableHead rowSpan={2}>Amt</TableHead>
          <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Percent</TableHead>
          <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Quantity</TableHead>
          <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Amount</TableHead>
        </TableRow>
        <TableRow>
          <TableHead className={bandBorder}>Previous</TableHead><TableHead>Current</TableHead><TableHead>{thirdLabel}</TableHead>
          <TableHead className={bandBorder}>Previous</TableHead><TableHead>Current</TableHead><TableHead>{thirdLabel}</TableHead>
          <TableHead className={bandBorder}>Previous</TableHead><TableHead>Current</TableHead><TableHead>{thirdLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const isChild = !!r.parentLineItemId; // WPR-06: percentages are parent-only
          return (
            <TableRow key={r.lineItemId}>
              <TableCell>{i + 1}</TableCell><TableCell>{r.categoryName}</TableCell>
              <TableCell className="font-mono text-xs">{r.code || "—"}</TableCell><TableCell>{r.description}</TableCell>
              <TableCell>{r.unit}</TableCell><TableCell>{money(r.rate)}</TableCell><TableCell>{money(r.amtTotal)}</TableCell>

              <TableCell className={bandBorder} data-testid="pct-prev">{isChild ? "" : `${r.percentage.prev}%`}</TableCell>
              <TableCell data-testid="pct-current">{isChild ? "" : `${r.percentage.current}%`}</TableCell>
              <TableCell data-testid="pct-third">{isChild ? "" : `${r.percentage[mode]}%`}</TableCell>

              <TableCell className={bandBorder}>{money(r.qty.prev)}</TableCell>
              <TableCell>{money(r.qty.current)}</TableCell>
              <TableCell>{money(r.qty[mode])}</TableCell>

              <TableCell className={bandBorder}>{money(r.amt.prev)}</TableCell>
              <TableCell>{money(r.amt.current)}</TableCell>
              <TableCell>{money(r.amt[mode])}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function CategoryTable({ rows, mode }: { rows: CategoryRow[]; mode: ThirdColumnMode }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">Nothing to break down by category yet.</p>;
  const thirdLabel = mode === "balance" ? "Balance" : "Total";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead><TableHead>Amt Total</TableHead>
          <TableHead>Amt Prev</TableHead><TableHead>Amt Current</TableHead><TableHead>Amt {thirdLabel} (to date)</TableHead>
          <TableHead>% Prev</TableHead><TableHead>% Current</TableHead><TableHead>% {thirdLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell>{r.name}</TableCell><TableCell>{money(r.amtTotal)}</TableCell>
            <TableCell>{money(r.amt.prev)}</TableCell><TableCell>{money(r.amt.current)}</TableCell><TableCell>{money(r.amt[mode])}</TableCell>
            <TableCell>{r.percentage.prev}%</TableCell><TableCell>{r.percentage.current}%</TableCell><TableCell>{r.percentage[mode]}%</TableCell>
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
  // Point 11: component state only -- never persisted, never sent to the API.
  const [thirdColumnMode, setThirdColumnMode] = useState<ThirdColumnMode>("total");

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
          {report && (
            <div className="space-y-1.5">
              <Label>Third column</Label>
              <Select value={thirdColumnMode} onValueChange={(v) => setThirdColumnMode(v as ThirdColumnMode)}>
                <SelectTrigger className="w-36" data-testid="third-column-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Total</SelectItem>
                  <SelectItem value="balance">Balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
              <TabsContent value="scope"><ScopeTable rows={report.rows} mode={thirdColumnMode} /></TabsContent>
              <TabsContent value="category"><CategoryTable rows={report.byCategory} mode={thirdColumnMode} /></TabsContent>
              <TabsContent value="manpower"><ManpowerTable rows={report.byManpower} /></TabsContent>
              <TabsContent value="vendor"><VendorTable rows={report.byVendor} /></TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
