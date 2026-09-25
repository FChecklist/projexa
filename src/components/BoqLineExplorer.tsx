"use client";

// PROJEXA-BUILD-001 U-33 (E-10). The project line search on the BOQ Object Page, shown only when BUILD001_BOQ_BROWSER_FIRST is on.
// It searches every line the gateway returned for this project (one BOQ, or all BOQs and revisions) without a request to any server:
// the index lives in a Web Worker (src/lib/boq-filter.worker.ts) and this component only sends a query and draws the window of rows
// that comes back. A window is at most WINDOW_ROWS rows, so typing in a 10,907-line project never puts more than that on the page,
// and the main thread does none of the matching.
//
// Which engine answered is printed on the panel (data-filter-engine, and the sentence under the box), so a browser that could not
// start a worker and searched on the main thread says so instead of just being slower.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { revisionLabel } from "@/lib/boq-lineage";
import { EMPTY_VALUE, formatDecimal } from "@/lib/format-number";
import { useOrgMoney } from "@/lib/use-org-money";
import type { BoqFilterClient } from "@/lib/boq-filter-client";
import type { BoqFilterResult } from "@/lib/boq-filter-engine";
import type { GatewayBoqLine } from "@/lib/boq-gateway-client";

const WINDOW_ROWS = 100;

type BoqLabel = Pick<GatewayBoqLine, "boqTitle" | "boqVersion" | "boqStatus">;

/** The "Title · Rev1 (status)" text of a row in the project scope. A row of the screen's own BOQ is labelled from `current` when given. */
function boqCaption(line: GatewayBoqLine, boqId: string, current: BoqLabel | undefined): string {
  const label: BoqLabel = line.boqId === boqId && current ? current : line;
  return `${label.boqTitle} · ${revisionLabel(label.boqVersion)} (${label.boqStatus})`;
}

type Scope = "boq" | "project";

export default function BoqLineExplorer({
  client,
  boqId,
  indexedLines,
  current,
}: {
  client: BoqFilterClient;
  /** The BOQ this page was opened for: the "This BOQ" scope. */
  boqId: string;
  /** Lines in the index. A new value means the index was refilled, so the last answer is stale. */
  indexedLines: number;
  /**
   * This BOQ as the screen has it now. The index is not refilled after a submit or an approve, so its rows of this BOQ still carry the
   * old status; in the project scope they are labelled from this instead.
   */
  current?: BoqLabel;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("boq");
  const [limit, setLimit] = useState(WINDOW_ROWS);
  const [result, setResult] = useState<(BoqFilterResult & { indexed: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const orgMoney = useOrgMoney();

  // Only the newest question may write to the screen: answers can come back out of order while a person is still typing.
  useEffect(() => {
    const ticket = ++latest.current;
    client.filter({ query, boqId: scope === "boq" ? boqId : null, limit }).then(
      (answer) => {
        if (ticket !== latest.current) return;
        setResult(answer);
        setError(null);
      },
      (err) => {
        if (ticket !== latest.current) return;
        setError(err instanceof Error ? err.message : "The line search failed");
      }
    );
  }, [client, query, scope, limit, boqId, indexedLines]);

  const inScope = scope === "boq" ? "this BOQ" : "the project";

  return (
    <section
      className="border-b border-ct-border"
      aria-label="Project line search"
      data-testid="boq-line-explorer"
      data-filter-engine={client.kind}
      data-indexed-lines={indexedLines}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ct-border bg-px-cloud px-4 py-2">
        <h3 className="text-[13px] font-semibold text-ct-navy">Project line search</h3>
        <div className="flex items-center gap-1" role="group" aria-label="Search scope">
          <Button
            type="button" size="sm" variant={scope === "boq" ? "default" : "outline"} aria-pressed={scope === "boq"}
            onClick={() => { setScope("boq"); setLimit(WINDOW_ROWS); }}
          >
            This BOQ
          </Button>
          <Button
            type="button" size="sm" variant={scope === "project" ? "default" : "outline"} aria-pressed={scope === "project"}
            onClick={() => { setScope("project"); setLimit(WINDOW_ROWS); }}
          >
            All BOQs in project
          </Button>
        </div>
      </div>

      <div className="space-y-2 px-4 py-3">
        <Input
          aria-label="Filter BOQ lines"
          placeholder="Filter by description, item code, category or unit"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setLimit(WINDOW_ROWS); }}
        />
        {error ? (
          <p role="alert" className="text-[12px] text-px-error">{error}</p>
        ) : (
          <p role="status" className="text-[11.5px] text-ct-muted" data-testid="boq-explorer-count">
            {result
              ? `Showing ${result.rows.length} of ${result.matched} matching lines (${result.total} in ${inScope}). Searched ${client.kind === "worker" ? "in a background worker" : "on the main thread"}.`
              : "Searching…"}
          </p>
        )}
      </div>

      {result && result.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-ct-border text-left text-[11px] font-medium uppercase tracking-wide text-ct-muted">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Amount</th>
                {scope === "project" && <th className="px-3 py-2">BOQ</th>}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((line) => {
                const qty = Number(line.quantity);
                return (
                  <tr key={line.id} className="border-b border-ct-border" data-testid="boq-explorer-row">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-ct-muted">{line.itemCode ?? EMPTY_VALUE}</td>
                    <td className={line.parentLineItemId ? "px-3 py-1.5 pl-6 text-ct-muted" : "px-3 py-1.5 font-medium text-ct-navy"}>{line.description}</td>
                    <td className="px-3 py-1.5 text-ct-muted">{line.category ?? EMPTY_VALUE}</td>
                    <td className="px-3 py-1.5 text-ct-muted">{line.unit}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number.isFinite(qty) ? formatDecimal(qty) : line.quantity}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{orgMoney.money(line.rate)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{orgMoney.money(line.amount)}</td>
                    {scope === "project" && (
                      <td className="px-3 py-1.5 text-ct-muted">
                        {boqCaption(line, boqId, current)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {result && result.matched > result.rows.length && (
        <div className="px-4 py-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setLimit((n) => n + WINDOW_ROWS)}>
            Show {Math.min(WINDOW_ROWS, result.matched - result.rows.length)} more
          </Button>
        </div>
      )}
    </section>
  );
}
