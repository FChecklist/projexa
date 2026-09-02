"use client";

// R67 lane D22 (item D-41, recs R-107/R-113) -- THE PROJECT'S BUDGET SCREEN.
//
// WHAT WAS WRONG: /budgets was the org-wide ERP fiscal-year ledger, which for
// the demo org rendered the sentence "No budgets found." Sumeet's Budget
// (6.png II) is not a fiscal-year ledger at all -- it is a per-scope-line
// attribute of one project's BOQ (vendor name, vendor amount, material,
// manpower), and the product already computes every figure it needs. So the
// route labelled Budget now shows the project's BOQ budget, and the ERP ledger
// moved intact to /accounting/annual-budgets (see that page's own comment; per
// correction C-15 it is NOT deleted).
//
// ONE CALL, NOT TWO: everything below comes from the already-registered
// "budget-variance" report (compliance-tracker's boqBudgetVarianceReport),
// widened by this same item to carry quantity/unit/rate and the BOQ's own
// identity so a row can deep-link back to /scope/{boqId}#line-{id} -- the BOQ
// object page stays the source of truth for the scope itself; this screen owns
// the money view of it.
//
// EDITING IS IN PLACE, and reuses the SAME PATCH /api/scope/line-items/{id}
// that ScopeObjectClient's inline Budget %/Vendor editors already use (R39/
// R-C09, widened by WS-I item I-03 with materialAmount/manpowerAmount). There
// is deliberately no second write path and no modal: the QS types in the cell,
// blurs, and the cell says what happened.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnalyticalScreen, BarChart, KpiTag, type BarChartDatum } from "@fchecklist/veridian-ui-kit/screens";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { withMoney } from "@/lib/money";
import { groupBudgetLinesByCategory, isOverBudget, type BudgetLine } from "@/lib/budget-lines";
import type { Vendor } from "@/lib/boq-helpers";

type BudgetVarianceReport = {
  boqId: string | null;
  boqTitle: string | null;
  boqVersion: number | null;
  lines: BudgetLine[];
  totalBudget: number;
  totalVendorAmount: number;
  totalMaterialAmount: number;
  totalManpowerAmount: number;
};

type FieldKey = "budgetPercentage" | "vendorId" | "vendorAmount" | "materialAmount" | "manpowerAmount";
type CellState = { status: "saving" | "saved" | "error"; message?: string };

// The three real outcomes of an inline save, spelled out beside the cell that
// caused them -- never a corner toast the eye has already left, and never a
// silent revert. "Saved" clears itself after 3 s; an error stays until the
// next attempt, because a message you have to act on must not time out.
const SAVED_VISIBLE_MS = 3000;

function CellFeedback({ state }: { state: CellState | undefined }) {
  if (!state) return null;
  if (state.status === "saving") return <span className="block text-[10px] text-px-muted">Saving…</span>;
  if (state.status === "saved") {
    return (
      <span className="flex items-center justify-end gap-0.5 text-[10px] text-px-success">
        <Check className="size-3" aria-hidden="true" />Saved
      </span>
    );
  }
  return <span role="alert" className="block text-[10px] text-px-error">{state.message}</span>;
}

export default function BudgetProjectClient({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [report, setReport] = useState<BudgetVarianceReport | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, vendorsData] = await Promise.all([
        fetchJson<BudgetVarianceReport>(`/api/reports/budget-variance?projectId=${encodeURIComponent(projectId)}`),
        fetchJson<{ vendors: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
      ]);
      setReport(data);
      setVendors(vendorsData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(errorMessage(err, "Couldn't load this project's budget"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // The PATCH the whole screen writes through. The edited value is applied to
  // the row from the SERVER's response, never from the typed string, so the
  // recomputed budget (amount x % / 100, computed server-side) is what the
  // Budget column and the totals below then show -- the row and the Grand
  // Total move together or not at all.
  async function saveField(lineItemId: string, field: FieldKey, value: number | string | null) {
    const key = `${lineItemId}:${field}`;
    setCells((prev) => ({ ...prev, [key]: { status: "saving" } }));
    try {
      const res = await fetch(`/api/scope/line-items/${encodeURIComponent(lineItemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setReport((prev) => {
        if (!prev) return prev;
        const lines = prev.lines.map((l) =>
          l.lineItemId === lineItemId
            ? {
                ...l,
                budgetPercentage: data.budgetPercentage !== undefined ? Number(data.budgetPercentage) : l.budgetPercentage,
                budget: data.budgetPercentage !== undefined
                  ? Math.round(l.amount * (Number(data.budgetPercentage) / 100) * 100) / 100
                  : l.budget,
                vendorId: data.vendorId !== undefined ? data.vendorId : l.vendorId,
                vendorName: data.vendorId !== undefined
                  ? (vendors.find((v) => v.id === data.vendorId)?.vendorName ?? null)
                  : l.vendorName,
                vendorAmount: data.vendorAmount !== undefined ? (data.vendorAmount === null ? null : Number(data.vendorAmount)) : l.vendorAmount,
                materialAmount: data.materialAmount !== undefined ? (data.materialAmount === null ? null : Number(data.materialAmount)) : l.materialAmount,
                manpowerAmount: data.manpowerAmount !== undefined ? (data.manpowerAmount === null ? null : Number(data.manpowerAmount)) : l.manpowerAmount,
              }
            : l
        );
        return { ...prev, lines };
      });
      setCells((prev) => ({ ...prev, [key]: { status: "saved" } }));
      setTimeout(() => setCells((prev) => {
        if (prev[key]?.status !== "saved") return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }), SAVED_VISIBLE_MS);
    } catch (err) {
      // The BACKEND's own sentence, at the field that caused it -- not a
      // generic "Couldn't save". The previous value is still on the row
      // because nothing was applied optimistically.
      setCells((prev) => ({ ...prev, [key]: { status: "error", message: errorMessage(err, "Couldn't save") } }));
    }
  }

  const lines = useMemo(() => report?.lines ?? [], [report]);
  const { groups, grandTotal } = useMemo(() => groupBudgetLinesByCategory(lines), [lines]);
  const linesOverBudget = useMemo(() => lines.filter(isOverBudget).length, [lines]);
  const bars: BarChartDatum[] = useMemo(
    () => groups.map((g) => ({ label: g.category, value: g.subtotal.budget, tone: g.subtotal.actual > g.subtotal.budget ? "late" : "done" })),
    [groups]
  );

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  let serial = 0;

  return (
    <AnalyticalScreen
      breadcrumb={`${projectName} / Budget`}
      kpiTags={
        <>
          <KpiTag label="Total budget" value={report ? withMoney(currencyCode, grandTotal.budget) : "—"} />
          <KpiTag label="Total actual" value={report ? withMoney(currencyCode, grandTotal.actual) : "—"} />
          <KpiTag label="Lines over budget" value={report ? String(linesOverBudget) : "—"} />
        </>
      }
      chart={
        bars.length > 0
          ? <BarChart data={bars} />
          : <p className="text-[12.5px] text-px-muted">No BOQ lines to budget yet.</p>
      }
      table={
        loading ? (
          <p className="px-4 py-6 text-[13px] text-px-muted">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-px-muted">
            This project has no BOQ lines yet — create a BOQ to budget it.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">S.No</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Budget %</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Vendor Amt</TableHead>
                <TableHead className="text-right">Material</TableHead>
                <TableHead className="text-right">Manpower</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={group.category}>
                  {group.lines.map((line) => {
                    serial += 1;
                    const isChild = !!line.parentLineItemId;
                    const cell = (field: FieldKey) => cells[`${line.lineItemId}:${field}`];
                    const busy = (field: FieldKey) => cell(field)?.status === "saving";
                    return (
                      <TableRow key={line.lineItemId} id={`line-${line.lineItemId}`}>
                        <TableCell className="text-right text-px-muted">{serial}</TableCell>
                        <TableCell className="text-px-muted">{line.category ?? "—"}</TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {/* The BOQ object page stays the source of truth for
                              the scope itself, so the code is the link back to
                              the exact line, not a dead string. */}
                          {report?.boqId ? (
                            <a className="text-px-steel underline-offset-2 hover:underline" href={`/scope/${report.boqId}#line-${line.lineItemId}`}>
                              {line.code ?? "—"}
                            </a>
                          ) : (line.code ?? "—")}
                        </TableCell>
                        <TableCell className={isChild ? "pl-6 text-px-muted" : "font-medium"}>{line.description}</TableCell>
                        <TableCell className="text-right">{line.quantity} {line.unit}</TableCell>
                        <TableCell className="text-right">{withMoney(currencyCode, line.rate)}</TableCell>
                        <TableCell className="text-right font-medium">{withMoney(currencyCode, line.amount)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number" aria-label={`Budget % for ${line.code ?? line.description}`}
                            title="default 25%" placeholder="default 25%"
                            className="w-20 text-right" disabled={busy("budgetPercentage")}
                            defaultValue={line.budgetPercentage}
                            onBlur={(e) => {
                              const pct = Number(e.target.value);
                              if (!Number.isFinite(pct) || pct === line.budgetPercentage) return;
                              saveField(line.lineItemId, "budgetPercentage", pct);
                            }}
                          />
                          <CellFeedback state={cell("budgetPercentage")} />
                        </TableCell>
                        <TableCell className="text-right">{withMoney(currencyCode, line.budget)}</TableCell>
                        <TableCell>
                          <Select
                            disabled={busy("vendorId")} value={line.vendorId ?? undefined}
                            onValueChange={(vendorId) => saveField(line.lineItemId, "vendorId", vendorId)}
                          >
                            <SelectTrigger className="w-[150px]" aria-label={`Vendor for ${line.code ?? line.description}`}>
                              <SelectValue placeholder="No vendor" />
                            </SelectTrigger>
                            <SelectContent>
                              {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <CellFeedback state={cell("vendorId")} />
                        </TableCell>
                        {(["vendorAmount", "materialAmount", "manpowerAmount"] as const).map((field) => (
                          <TableCell key={field} className="text-right">
                            <Input
                              type="number" className="w-24 text-right" placeholder="—"
                              aria-label={`${field === "vendorAmount" ? "Vendor Amt" : field === "materialAmount" ? "Material" : "Manpower"} for ${line.code ?? line.description}`}
                              disabled={busy(field)} defaultValue={line[field] ?? ""}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const amt = raw === "" ? null : Number(raw);
                                if (raw !== "" && !Number.isFinite(amt)) return;
                                if (amt === (line[field] ?? null)) return;
                                saveField(line.lineItemId, field, amt);
                              }}
                            />
                            <CellFeedback state={cell(field)} />
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-px-cloud/50">
                    <TableCell />
                    <TableCell colSpan={5} className="text-[12px] font-medium">{group.category} subtotal</TableCell>
                    <TableCell className="text-right font-medium">{withMoney(currencyCode, group.subtotal.amount)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-medium">{withMoney(currencyCode, group.subtotal.budget)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-medium">{withMoney(currencyCode, group.subtotal.vendorAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{withMoney(currencyCode, group.subtotal.materialAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{withMoney(currencyCode, group.subtotal.manpowerAmount)}</TableCell>
                  </TableRow>
                </Fragment>
              ))}
              <TableRow className="border-t-2 border-px-border2 bg-px-cloud">
                <TableCell />
                <TableCell colSpan={5} className="text-[12px] font-semibold">Grand total</TableCell>
                <TableCell className="text-right font-semibold">{withMoney(currencyCode, grandTotal.amount)}</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold">{withMoney(currencyCode, grandTotal.budget)}</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold">{withMoney(currencyCode, grandTotal.vendorAmount)}</TableCell>
                <TableCell className="text-right font-semibold">{withMoney(currencyCode, grandTotal.materialAmount)}</TableCell>
                <TableCell className="text-right font-semibold">{withMoney(currencyCode, grandTotal.manpowerAmount)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )
      }
      filterAction={{ label: "Filter", disabledReason: "Filter the Budget on Scope of Work / Budget" }}
      exportAction={{ label: "Export", disabledReason: "Export the Budget on Scope of Work / Budget" }}
      newAction={report?.boqId ? { label: "Open BOQ", onClick: () => router.push(`/scope/${report.boqId}`) } : undefined}
    />
  );
}
