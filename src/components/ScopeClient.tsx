"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, GitCompare, GitBranchPlus, Eye } from "lucide-react";
import { useCurrencies } from "@/lib/currency";

type Boq = {
  id: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
};

type LineItemDraft = { description: string; unit: string; quantity: string; rate: string; itemCode?: string; activityId?: string; parentItemCode?: string; breakdownPercentage?: string };

type BoqLineItemRow = {
  id: string; itemCode: string | null; description: string; unit: string;
  quantity: string; rate: string; amount: string; activityId: string | null;
  parentLineItemId?: string | null; breakdownPercentage?: string | null;
};

type ChangedLineItem = {
  key: string; previous: BoqLineItemRow; current: BoqLineItemRow;
  quantityChange: number; rateChange: number; netVariation: number;
};

type BoqComparison = {
  added: BoqLineItemRow[]; removed: BoqLineItemRow[]; changed: ChangedLineItem[];
  warnings: string[]; totalVariation: number;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", submitted: "default", approved: "outline", superseded: "destructive",
};

const emptyLine = (): LineItemDraft => ({ description: "", unit: "", quantity: "", rate: "", itemCode: "", parentItemCode: "", breakdownPercentage: "" });

function toDrafts(rows: BoqLineItemRow[]): LineItemDraft[] {
  // Every row needs a resolvable itemCode: the API re-links a sub-task to its
  // parent by matching parentItemCode to an itemCode in the SAME submission,
  // and itemCode is nullable in the database. Synthesise one where it is
  // missing, or a sub-task silently becomes top-level on revision and the
  // total re-inflates.
  const codeById = new Map<string, string>();
  const taken = new Set(rows.map((r) => r.itemCode?.trim()).filter((c): c is string => Boolean(c)));
  for (const r of rows) {
    const existing = r.itemCode?.trim();
    if (existing) { codeById.set(r.id, existing); continue; }
    let synth = `_row_${r.id}`;
    while (taken.has(synth)) synth = `${synth}_x`;
    taken.add(synth);
    codeById.set(r.id, synth);
  }
  return rows.map((row) => ({
    description: row.description,
    unit: row.unit,
    quantity: String(row.quantity),
    rate: String(row.rate),
    itemCode: codeById.get(row.id),
    activityId: row.activityId ?? undefined,
    parentItemCode: row.parentLineItemId ? codeById.get(row.parentLineItemId) : undefined,
    breakdownPercentage: row.breakdownPercentage != null ? String(row.breakdownPercentage) : undefined,
  }));
}

function formatVariation(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatAmount(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value ?? "");
}

// Deliberately NOT currencyLabel() from the shared helper: that returns a
// hardcoded rupee symbol when no base currency is found, which would be wrong
// on a UAE contractor's BOQ. Here an unresolved currency degrades to the bare
// number instead - no label is survivable, the wrong label is not.
function withCurrency(code: string, value: string | number | null | undefined): string {
  const n = formatAmount(value);
  return code ? `${code} ${n}` : n;
}

// A weighted sub-task's amount is DERIVED from its parent (parent qty x parent
// rate x breakdown %), so it is already contained in the parent's amount.
// Summing every row flat double-counts the BOQ. Top-level rows only.
function boqTotal(rows: BoqLineItemRow[]): number {
  return rows
    .filter((r) => !r.parentLineItemId)
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
}

export default function ScopeClient({ projectId }: { projectId: string }) {
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  // Variation vs. immediate parent, per revision -- the "running total
  // variation value" the Owner asked for, fetched from VERIDIAN's compareBoq
  // rather than stored (this codebase computes diffs at read time, never
  // denormalizes them).
  const [variationByBoqId, setVariationByBoqId] = useState<Record<string, number>>({});

  const [revising, setRevising] = useState<Boq | null>(null);
  const [revisionLines, setRevisionLines] = useState<LineItemDraft[]>([]);
  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const [revisionBlock, setRevisionBlock] = useState<string | null>(null);

  const [comparing, setComparing] = useState<Boq | null>(null);
  const [comparison, setComparison] = useState<BoqComparison | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  const [viewing, setViewing] = useState<Boq | null>(null);
  const [viewRows, setViewRows] = useState<BoqLineItemRow[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      const loaded: Boq[] = data.boqs ?? [];
      setBoqs(loaded);

      const revisions = loaded.filter((b) => b.parentBoqId);
      const entries = await Promise.all(
        revisions.map(async (b) => {
          const cmpRes = await fetch(`/api/scope/${b.id}/compare`);
          if (!cmpRes.ok) return null;
          const cmp: BoqComparison = await cmpRes.json();
          return [b.id, cmp.totalVariation] as const;
        })
      );
      setVariationByBoqId(Object.fromEntries(entries.filter((e): e is readonly [string, number] => e !== null)));
    } catch {
      toast.error("Couldn't load scope of work");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function createBoq() {
    if (!title.trim()) return;
    const validLines = lines.filter((l) => {
      if (!l.description.trim() || !l.unit.trim()) return false;
      if (l.parentItemCode?.trim()) return true;
      return Boolean(l.quantity && l.rate);
    });
    if (validLines.length === 0) {
      toast.error("Add at least one complete line item");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title,
          lineItems: validLines.map((l) => ({
            description: l.description,
            unit: l.unit,
            quantity: Number(l.quantity),
            rate: Number(l.rate),
            ...(l.itemCode?.trim() ? { itemCode: l.itemCode.trim() } : {}),
            ...(l.parentItemCode?.trim() ? { parentItemCode: l.parentItemCode.trim() } : {}),
            ...(l.breakdownPercentage?.trim() ? { breakdownPercentage: Number(l.breakdownPercentage) } : {}),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't create BOQ");
      toast.success("BOQ created");
      setTitle(""); setLines([emptyLine()]); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create BOQ");
    } finally {
      setSubmitting(false);
    }
  }

  async function openRevisionDialog(boq: Boq) {
    setRevising(boq);
    setRevisionTitle(boq.title);
    setRevisionBlock(null);
    try {
      const res = await fetch(`/api/scope/${boq.id}`);
      const data = await res.json();
      const rows: BoqLineItemRow[] = data.lineItems ?? [];
      setRevisionLines(rows.length > 0 ? toDrafts(rows) : [emptyLine()]);
    } catch {
      toast.error("Couldn't load the current scope to revise");
      setRevisionLines([emptyLine()]);
    }
  }

  function updateRevisionLine(index: number, field: keyof LineItemDraft, value: string) {
    setRevisionLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function submitRevision(allowScopeReductionOverride = false) {
    if (!revising) return;
    const validLines = revisionLines.filter((l) => {
      if (!l.description.trim() || !l.unit.trim()) return false;
      if (l.parentItemCode?.trim()) return true;
      return Boolean(l.quantity && l.rate);
    });
    if (validLines.length === 0) {
      toast.error("Add at least one complete line item");
      return;
    }
    setRevisionSubmitting(true);
    setRevisionBlock(null);
    try {
      const res = await fetch(`/api/scope/${revising.id}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: revisionTitle,
          lineItems: validLines.map((l) => ({
            description: l.description, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate),
            ...(l.itemCode?.trim() ? { itemCode: l.itemCode.trim() } : {}), ...(l.activityId ? { activityId: l.activityId } : {}),
            ...(l.parentItemCode?.trim() ? { parentItemCode: l.parentItemCode.trim() } : {}),
            ...(l.breakdownPercentage?.trim() ? { breakdownPercentage: Number(l.breakdownPercentage) } : {}),
          })),
          allowScopeReductionOverride,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Owner's hard-block rule: this revision would reduce/remove scope
        // already completed on site. Surface the real reason and let the
        // user explicitly override instead of silently failing or silently
        // applying it.
        setRevisionBlock(data.error ?? "This revision reduces scope already completed on site.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to create revision");
      toast.success(allowScopeReductionOverride ? "Revision created (override applied)" : "Revision created");
      setRevising(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create revision");
    } finally {
      setRevisionSubmitting(false);
    }
  }

  async function openViewDialog(boq: Boq) {
    setViewing(boq);
    setViewRows([]);
    setViewLoading(true);
    try {
      const res = await fetch(`/api/scope/${boq.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load this BOQ");
      setViewRows(data.lineItems ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load this BOQ");
      setViewing(null);
    } finally {
      setViewLoading(false);
    }
  }

  async function openCompareDialog(boq: Boq) {
    setComparing(boq);
    setComparison(null);
    setComparisonLoading(true);
    try {
      const res = await fetch(`/api/scope/${boq.id}/compare`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to compare revisions");
      setComparison(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't compare revisions");
      setComparing(null);
    } finally {
      setComparisonLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New BOQ</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Bill of Quantities</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Civil Works - Phase 1" /></div>
              <div className="space-y-2">
                <Label>Line Items</Label>
                {lines.map((line, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input className="min-w-[180px] flex-1" placeholder="Description" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                    <Input className="w-[80px] shrink-0" placeholder="Unit" value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                    <Input className="w-[90px] shrink-0" placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                    <Input className="w-[90px] shrink-0" placeholder="Rate" type="number" value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                    <Input className="w-[110px] shrink-0" placeholder="Item Code" value={line.itemCode ?? ""} onChange={(e) => updateLine(i, "itemCode", e.target.value)} />
                    <Input className="w-[130px] shrink-0" placeholder="Parent Item Code" value={line.parentItemCode ?? ""} onChange={(e) => updateLine(i, "parentItemCode", e.target.value)} />
                    <Input className="w-[110px] shrink-0" placeholder="Breakdown %" type="number" value={line.breakdownPercentage ?? ""} onChange={(e) => updateLine(i, "breakdownPercentage", e.target.value)} />
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                  <Plus className="size-3.5" /> Add Line
                </Button>
              </div>
            </div>
            <DialogFooter><Button onClick={createBoq} disabled={submitting}>{submitting ? "Creating…" : "Create BOQ"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : boqs.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No BOQs yet for this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead>
                  <TableHead>Variation vs. prior</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boqs.map((b) => {
                  const variation = variationByBoqId[b.id];
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-px-muted">v{b.version}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                      <TableCell>
                        {!b.parentBoqId ? (
                          <span className="text-px-muted">Baseline (Rev0)</span>
                        ) : variation === undefined ? (
                          <span className="text-px-muted">—</span>
                        ) : (
                          <span className={variation > 0 ? "text-px-success" : variation < 0 ? "text-px-error" : "text-px-muted"}>{currencyCode ? `${currencyCode} ` : ""}{formatVariation(variation)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-px-muted">{new Date(b.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => openViewDialog(b)}><Eye className="size-3.5" /> View</Button>
                        {b.parentBoqId && (
                          <Button variant="ghost" size="sm" onClick={() => openCompareDialog(b)}><GitCompare className="size-3.5" /> Compare</Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openRevisionDialog(b)}><GitBranchPlus className="size-3.5" /> New Revision</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.title} (v{viewing?.version})</DialogTitle></DialogHeader>
          {viewLoading ? (
            <div className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : viewRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-px-muted">This BOQ has no line items.</p>
          ) : (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Code</TableHead><TableHead>Description</TableHead><TableHead>Unit</TableHead>
                    <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewRows.map((r) => {
                    const isSub = Boolean(r.parentLineItemId);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className={isSub ? "pl-8 text-px-muted" : "font-medium"}>{r.itemCode ?? "—"}</TableCell>
                        <TableCell className={isSub ? "pl-4" : ""}>
                          {r.description}
                          {isSub && r.breakdownPercentage != null && (
                            <span className="ml-2 text-xs text-px-muted">{r.breakdownPercentage}% of parent</span>
                          )}
                        </TableCell>
                        <TableCell className="text-px-muted">{r.unit}</TableCell>
                        <TableCell className="text-right text-px-muted">{isSub ? "—" : formatAmount(r.quantity)}</TableCell>
                        <TableCell className="text-right text-px-muted">{isSub ? "—" : withCurrency(currencyCode, r.rate)}</TableCell>
                        <TableCell className="text-right">{withCurrency(currencyCode, r.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex justify-end border-t pt-3 text-sm">
                <span className="text-px-muted">Total</span>
                <span className="ml-4 font-medium">{withCurrency(currencyCode, boqTotal(viewRows))}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!revising} onOpenChange={(o) => !o && setRevising(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Revision -- from &quot;{revising?.title}&quot; (v{revising?.version})</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Revision Title</Label><Input value={revisionTitle} onChange={(e) => setRevisionTitle(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Line Items</Label>
              {revisionLines.map((line, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input className="min-w-[180px] flex-1" placeholder="Description" value={line.description} onChange={(e) => updateRevisionLine(i, "description", e.target.value)} />
                  <Input className="w-[80px] shrink-0" placeholder="Unit" value={line.unit} onChange={(e) => updateRevisionLine(i, "unit", e.target.value)} />
                  <Input className="w-[90px] shrink-0" placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateRevisionLine(i, "quantity", e.target.value)} />
                  <Input className="w-[90px] shrink-0" placeholder="Rate" type="number" value={line.rate} onChange={(e) => updateRevisionLine(i, "rate", e.target.value)} />
                  <Input className="w-[110px] shrink-0" placeholder="Item Code" value={line.itemCode ?? ""} onChange={(e) => updateRevisionLine(i, "itemCode", e.target.value)} />
                  <Input className="w-[130px] shrink-0" placeholder="Parent Item Code" value={line.parentItemCode ?? ""} onChange={(e) => updateRevisionLine(i, "parentItemCode", e.target.value)} />
                  <Input className="w-[110px] shrink-0" placeholder="Breakdown %" type="number" value={line.breakdownPercentage ?? ""} onChange={(e) => updateRevisionLine(i, "breakdownPercentage", e.target.value)} />
                  <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setRevisionLines((prev) => prev.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setRevisionLines((prev) => [...prev, emptyLine()])}>
                <Plus className="size-3.5" /> Add Line
              </Button>
              <p className="text-xs text-px-muted">Removing a line, or reducing its quantity/rate, is blocked if that item is already recorded as complete on site.</p>
            </div>
            {revisionBlock && (
              <Card className="border-px-error-border bg-px-error-light">
                <CardContent className="space-y-2 p-3 text-sm text-px-error">
                  <p>{revisionBlock}</p>
                  <Button size="sm" variant="destructive" onClick={() => submitRevision(true)} disabled={revisionSubmitting}>
                    Apply anyway (override)
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => submitRevision(false)} disabled={revisionSubmitting}>{revisionSubmitting ? "Creating…" : "Create Revision"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!comparing} onOpenChange={(o) => !o && setComparing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Compare -- &quot;{comparing?.title}&quot; (v{comparing?.version}) vs. prior revision</DialogTitle></DialogHeader>
          {comparisonLoading ? (
            <div className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : comparison ? (
            <div className="space-y-3">
              <p className="text-sm">
                Total variation:{" "}
                <span className={comparison.totalVariation > 0 ? "text-px-success" : comparison.totalVariation < 0 ? "text-px-error" : ""}>
                  {currencyCode ? `${currencyCode} ` : ""}{formatVariation(comparison.totalVariation)}
                </span>
              </p>
              {comparison.warnings.length > 0 && (
                <Card className="border-px-error-border bg-px-error-light">
                  <CardContent className="space-y-1 p-3 text-sm text-px-error">
                    {comparison.warnings.map((w, i) => <p key={i}>{w}</p>)}
                  </CardContent>
                </Card>
              )}
              {comparison.added.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Added</p>
                  {comparison.added.map((i) => <p key={i.id} className="text-sm text-px-success">+ {i.description} ({withCurrency(currencyCode, i.amount)})</p>)}
                </div>
              )}
              {comparison.removed.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Removed</p>
                  {comparison.removed.map((i) => <p key={i.id} className="text-sm text-px-error">- {i.description} ({withCurrency(currencyCode, i.amount)})</p>)}
                </div>
              )}
              {comparison.changed.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Changed</p>
                  {comparison.changed.map((c) => (
                    <p key={c.current.id} className="text-sm">
                      {c.current.description}: {formatVariation(c.netVariation)}
                    </p>
                  ))}
                </div>
              )}
              {comparison.added.length === 0 && comparison.removed.length === 0 && comparison.changed.length === 0 && (
                <p className="text-sm text-px-muted">No differences between these two revisions.</p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
