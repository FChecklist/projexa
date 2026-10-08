"use client";

// R-96: the project-level "Scope of Work" overview, the first tab of /scope.
//
// In this product a BOQ IS a Scope of Work record (see src/lib/object-screens.ts); this tab is the plain-English front
// door to it: what the current approved scope is, what came before it, what changed since the original, and which change
// orders are waiting. It does NOT duplicate the BOQ editor: every action is a link into the existing BOQ screens.
//
// DATA: the BOQ rows are the same headers-only list the BOQ tab already holds (no line items, no extra request). The only
// read of its own is the project's change orders (GET /api/change-orders, an existing route). No new API route.
//
// MONEY: formatted by useOrgMoney like the BOQ list, and shown ONLY where the payload carries a figure. A role whose
// payload has no figure (the server redacts it) sees the em-dash, never a zero and never a guess.
//
// OFFLINE: this tab reads over the network. The laptop's own copy has the BOQ list screen (Scope of Work (BOQ)) for offline use.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill, StatusPillTone, type SemanticStatus } from "@/components/ui/status-pill";
import { EMPTY_VALUE } from "@/lib/format-money";
import { formatDate } from "@/lib/format";
import { useOrgMoney } from "@/lib/use-org-money";
import { fetchJson } from "@/lib/fetch-json";
import { buildScopeOverview, type OverviewBoq } from "@/lib/scope-overview";

const BOQ_STATUS: Record<string, SemanticStatus> = { draft: "draft", submitted: "running", approved: "current", superseded: "superseded" };

type ChangeOrder = { id: string; number: number; title: string; costImpact?: string | null; scheduleImpactDays?: number | null; status: string };

function Status({ status }: { status: string }) {
  return BOQ_STATUS[status] ? <StatusPill status={BOQ_STATUS[status]} label={status} /> : <StatusPillTone tone="neutral" label={status} />;
}

export default function ScopeOverviewClient({
  projectId,
  projectName,
  boqs,
  initialChangeOrders,
}: {
  projectId: string;
  projectName?: string | null;
  boqs: OverviewBoq[];
  /** Test seam / server seed. When given, no change-order request is made. */
  initialChangeOrders?: ChangeOrder[];
}) {
  const orgMoney = useOrgMoney();
  const overview = useMemo(() => buildScopeOverview(boqs), [boqs]);
  const [orders, setOrders] = useState<ChangeOrder[] | null>(initialChangeOrders ?? null);
  const [ordersFailed, setOrdersFailed] = useState(false);

  useEffect(() => {
    if (initialChangeOrders) return;
    const ctl = new AbortController();
    fetchJson(`/api/change-orders?projectId=${encodeURIComponent(projectId)}`, { signal: ctl.signal })
      .then((d) => setOrders((d.changeOrders as ChangeOrder[] | undefined) ?? []))
      .catch((e) => {
        if (!ctl.signal.aborted && !(e instanceof Error && e.name === "AbortError")) setOrdersFailed(true);
      });
    return () => ctl.abort();
  }, [projectId, initialChangeOrders]);

  const money = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? orgMoney.money(v) : EMPTY_VALUE);
  const signed = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? orgMoney.signedMoney(v) : EMPTY_VALUE);
  const { current } = overview;
  const pending = (orders ?? []).filter((c) => c.status === "pending_approval");

  if (!current) {
    return (
      <Card data-testid="scope-overview" data-state="empty">
        <CardContent className="space-y-3 p-8 text-center text-sm text-px-muted">
          <p>{projectName ? `${projectName} has no Scope of Work yet.` : "This project has no Scope of Work yet."}</p>
          <div className="flex justify-center gap-2">
            <Button asChild size="sm"><Link href="/scope/new">New Scope of Work (BOQ)</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href="/scope/import">Import from Excel</Link></Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="scope-overview" data-state="ready">
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="font-heading text-lg text-px-ink">{overview.currentApproved ? "Current approved Scope of Work" : "Current Scope of Work"}</h2>
          {!overview.currentApproved && (
            <p className="text-sm text-px-muted" data-testid="scope-not-approved">Nothing is approved yet. This is the latest {current.status} version.</p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div><dt className="text-px-muted">Title</dt><dd className="font-medium text-px-ink" data-testid="scope-current-title">{current.title}</dd></div>
            <div><dt className="text-px-muted">Version</dt><dd data-testid="scope-current-rev">{overview.currentRevLabel}</dd></div>
            <div><dt className="text-px-muted">Status</dt><dd><Status status={current.status} /></dd></div>
            <div><dt className="text-px-muted">Total</dt><dd data-testid="scope-current-total">{money(current.compare?.total)}</dd></div>
            <div><dt className="text-px-muted">Line items</dt><dd data-testid="scope-current-lines">{current.compare ? current.compare.lineCount : EMPTY_VALUE}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm"><Link href={`/scope/${current.id}`}>Open BOQ</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`/scope/${current.id}/revise`}>Create a revision</Link></Button>
            {overview.previous.length > 0 && (
              <Button asChild size="sm" variant="outline"><Link href={`/scope/${current.id}/compare`}>Compare revisions</Link></Button>
            )}
          </div>
          {overview.otherScopes > 0 && (
            <p className="text-xs text-px-muted" data-testid="scope-other-scopes">
              This project has {overview.otherScopes} other Scope of Work {overview.otherScopes === 1 ? "list" : "lists"}; see the BOQ tab.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-5">
          <h2 className="font-heading text-lg text-px-ink">Earlier versions</h2>
          {overview.previous.length === 0 ? (
            <p className="text-sm text-px-muted" data-testid="scope-no-previous">No earlier versions: this is the original.</p>
          ) : (
            <ul className="divide-y divide-px-line text-sm" data-testid="scope-previous">
              {overview.previous.map(({ boq, revLabel }) => (
                <li key={boq.id} className="flex items-center justify-between gap-3 py-2" data-testid="scope-previous-row">
                  <span><span className="tabular-nums text-px-muted">{revLabel}</span> {boq.title} <span className="text-px-muted">({formatDate(boq.createdAt)})</span></span>
                  <span className="flex items-center gap-3"><Status status={boq.status} /><Link className="underline" href={`/scope/${boq.id}`}>Open</Link></span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-5">
          <h2 className="font-heading text-lg text-px-ink">What changed since the original</h2>
          {overview.variations.length === 0 ? (
            <p className="text-sm text-px-muted" data-testid="scope-no-variations">No revisions yet, so nothing has changed since the original.</p>
          ) : (
            <table className="w-full text-sm" data-testid="scope-variations">
              <thead><tr className="text-left text-px-muted"><th>Version</th><th className="text-right">Change vs previous{orgMoney.unitSuffix}</th><th className="text-right">Change vs original{orgMoney.unitSuffix}</th></tr></thead>
              <tbody>
                {overview.variations.map((v) => (
                  <tr key={v.boq.id} data-testid="scope-variation-row">
                    <td className="tabular-nums">{v.revLabel}</td>
                    <td className="text-right tabular-nums">{signed(v.vsPrior)}</td>
                    <td className="text-right tabular-nums">{signed(v.vsOriginal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-5">
          <h2 className="font-heading text-lg text-px-ink">Change orders waiting for approval</h2>
          {ordersFailed ? (
            <p className="text-sm text-px-muted" data-testid="scope-orders-failed">Change orders could not be loaded just now.</p>
          ) : orders === null ? (
            <p className="text-sm text-px-muted">Loading change orders…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-px-muted" data-testid="scope-no-orders">No change orders are waiting for approval in this project.</p>
          ) : (
            <ul className="divide-y divide-px-line text-sm" data-testid="scope-orders">
              {pending.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2" data-testid="scope-order-row">
                  <Link className="underline" href={`/change-orders/${c.id}`}>CO-{c.number} {c.title}</Link>
                  <span className="tabular-nums">{money(c.costImpact == null || c.costImpact === "" ? null : Number(c.costImpact))}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-px-muted">Change orders are listed for the whole project; they are not tied to one BOQ version.</p>
        </CardContent>
      </Card>
      <p className="text-xs text-px-muted" data-testid="scope-online-note">This tab reads from the server and needs a connection. Offline, use the Scope of Work (BOQ) list on this laptop.</p>
    </div>
  );
}
