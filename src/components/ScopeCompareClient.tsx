"use client";

// Real-screen conversion (2026-08-30) -- replaces ScopeClient.tsx's old
// Compare Dialog popup with a real screen. Not an edit/create workflow (no
// Save/Edit/Delete -- only Back plus a real "Against" selector), so this
// wraps ScreenFrame directly rather than ObjectScreen, whose footer is
// fixed to Edit/Delete/Save/Cancel and doesn't fit a pure-display screen.
import { readScopeHeaders } from "@/lib/scope-list-reads";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScreenFrame, CompareScreen, type ScreenColumn, type CompareResult, type CompareChangedRow } from "@fchecklist/veridian-ui-kit/screens";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCurrencies } from "@/lib/currency";
import { fetchJson } from "@/lib/fetch-json";
// GUIDED ERRORS (G1): a comparison that cannot be made is told in the inline panel (what happened, why, what to do, the way to the right place).
import { ActionFailurePanel, type ActionFailureState } from "@/components/ActionFailure";
import { type Boq, type BoqComparison, formatVariation } from "@/lib/boq-helpers";

const DEFAULT_COMPARE_COLUMNS: ScreenColumn[] = [
  { field: "description", label: "Description", type: "text", importance: "High" },
  { field: "unit", label: "Unit", type: "text", importance: "High" },
  { field: "quantity", label: "Qty", type: "number", importance: "High" },
  { field: "rate", label: "Rate", type: "number", importance: "High" },
  { field: "amount", label: "Amount", type: "number", importance: "High" },
];

function toCompareResult(cmp: BoqComparison): CompareResult {
  const changed: CompareChangedRow[] = cmp.changed.map((c) => {
    const changedFields: string[] = [];
    if (c.quantityChange !== 0) changedFields.push("quantity");
    if (c.rateChange !== 0) changedFields.push("rate");
    if (c.quantityChange !== 0 || c.rateChange !== 0 || c.breakdownPercentageChange !== 0) changedFields.push("amount");
    if (c.breakdownPercentageChange !== 0) changedFields.push("breakdownPercentage");
    return { key: c.key, previous: c.previous, current: c.current, changedFields };
  });
  return { added: cmp.added, removed: cmp.removed, changed, warnings: cmp.warnings };
}

export default function ScopeCompareClient({ boqId, compareColumns }: { boqId: string; compareColumns?: ScreenColumn[] | null }) {
  const router = useRouter();
  const columns = compareColumns && compareColumns.length > 0 ? compareColumns : DEFAULT_COMPARE_COLUMNS;
  const [boq, setBoq] = useState<Boq | null>(null);
  const [siblings, setSiblings] = useState<Boq[]>([]);
  const [against, setAgainst] = useState<string>("");
  const [comparison, setComparison] = useState<BoqComparison | null>(null);
  // R67 D-27: the Architect/Site Instruction attached to THIS revision, if any.
  const [siteInstruction, setSiteInstruction] = useState<{ id: string; siNumber: number; boqId: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ActionFailureState | null>(null);
  // a comparison that failed while the screen itself is fine (the "Against" choice was refused): shown above the table, the screen stays usable
  const [compareFailure, setCompareFailure] = useState<ActionFailureState | null>(null);
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  function findOriginalBoqId(current: Boq, all: Boq[]): string {
    let cur = current;
    while (cur.parentBoqId) {
      const parent = all.find((b) => b.id === cur.parentBoqId);
      if (!parent) break;
      cur = parent;
    }
    return cur.id;
  }

  async function loadComparison(targetAgainst: string) {
    setLoading(true);
    try {
      const data = await fetchJson<BoqComparison>(`/api/scope/${boqId}/compare?against=${encodeURIComponent(targetAgainst)}`);
      setComparison(data);
      setLoadError(null);
      setCompareFailure(null);
    } catch (err) {
      setComparison(null);
      setCompareFailure({ err, at: Date.now(), retry: () => void loadComparison(targetAgainst) });
    } finally {
      setLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<Boq & { lineItems: unknown }>(`/api/scope/${boqId}`);
      setBoq(data);
      const listData = await readScopeHeaders<Boq>(data.projectId);
      setSiblings(listData.boqs ?? []);
      const original = findOriginalBoqId(data, listData.boqs ?? []);
      setAgainst(original);
      setLoadError(null);
      // An original BOQ (no parent) that nothing has been revised from has nothing to be compared with: say so in words instead of comparing it
      // with itself. (Other, unrelated BOQs of the project do not count: they are different documents.)
      if (!data.parentBoqId && !(listData.boqs ?? []).some((b) => b.parentBoqId === data.id)) {
        setComparison(null);
        setCompareFailure({ err: Object.assign(new Error("This BOQ has no previous revision to compare against"), { status: 400, apiPath: `/api/scope/${boqId}/compare`, method: "GET" }), at: Date.now() });
        setLoading(false);
        return;
      }
      // Non-fatal: a missing or failing instruction lookup must never stop the
      // comparison rendering.
      void fetchJson<{ siteInstructions?: { id: string; siNumber: number; boqId: string | null }[] }>(
        `/api/site-instructions?projectId=${encodeURIComponent(data.projectId)}`
      )
        .then((si) => setSiteInstruction((si.siteInstructions ?? []).find((row) => row.boqId === boqId) ?? null))
        .catch(() => setSiteInstruction(null));
      await loadComparison(original);
    } catch (err) {
      setBoq(null);
      setLoadError({ err, at: Date.now() });
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [boqId]);

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <ActionFailurePanel failure={loadError} entityType="boq" entityId={boqId} onRetry={() => load()} retryable />
      </div>
    );
  }
  if (!boq) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ScreenFrame
      breadcrumb={
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => router.push(`/scope/${boqId}`)} className="text-ct-muted hover:text-ct-navy">← Back</button>
          {`Scope / Compare — "${boq.title}" (v${boq.version})`}
        </span>
      }
      footerActions={<Button variant="outline" size="sm" onClick={() => router.push(`/scope/${boqId}`)}>Back to BOQ</Button>}
      messages={[]}
    >
      <div className="space-y-3 p-4">
        <ActionFailurePanel failure={compareFailure} entityType="boq" entityId={boqId} projectId={boq.projectId} />
        <div className="max-w-xs space-y-1.5">
          <Label>Against</Label>
          <Select value={against} onValueChange={(v) => { setAgainst(v); void loadComparison(v); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {siblings.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.title} (v{b.version}){!b.parentBoqId ? " — Original" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {loading ? (
          <p className="text-sm text-ct-muted">Loading comparison…</p>
        ) : comparison ? (
          <div className="space-y-2">
            <p className="text-sm">
              Total variation:{" "}
              <span className={comparison.totalVariation > 0 ? "text-px-success" : comparison.totalVariation < 0 ? "text-px-error" : ""}>
                {currencyCode ? `${currencyCode} ` : ""}{formatVariation(comparison.totalVariation)}
              </span>
              {/* R67 D-27: the instruction that authorised this variation, beside
                  the number it authorised. A variation with no instruction on
                  file says so rather than leaving the question unasked. */}
              <span className="ml-3 text-px-muted">
                Site instruction:{" "}
                {siteInstruction ? (
                  <button type="button" className="underline" onClick={() => router.push(`/scope/${boqId}`)}>
                    SI-{siteInstruction.siNumber}
                  </button>
                ) : (
                  <span>–</span>
                )}
              </span>
            </p>
            <div className="h-[520px] rounded-md border border-ct-border">
              <CompareScreen
                functionId="boq.compare"
                breadcrumb={`v${siblings.find((b) => b.id === against)?.version ?? "?"} → v${boq.version}`}
                columns={columns}
                fromLabel={`v${siblings.find((b) => b.id === against)?.version ?? "?"}`}
                toLabel={`v${boq.version}`}
                result={toCompareResult(comparison)}
                getRowId={(row) => String((row as { id: string }).id)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </ScreenFrame>
  );
}
