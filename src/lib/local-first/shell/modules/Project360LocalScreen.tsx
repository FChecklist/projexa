"use client";

// LOCAL-FIRST shell, overview cluster: PROJECT 360 on this laptop. The margin/cost/profit analysis is the server's (the last answer of
// GET /api/reports/boq-analysis kept here, "As of ..., from this laptop", refreshed while connected). Beside it, what the laptop can count
// exactly: change orders, milestones and progress claims by status -- their amounts are never added up here. The schedule's critical
// path is recalculated by the server when online.

import type { ShellScreenProps } from "../types";
import { asOfLabel } from "../snapshot-cache";
import { boqAnalysisSnapshotName, boqAnalysisUrl, isBoqAnalysisBody, type Project360Data } from "./analysis-adapter";
import type { Fact } from "./dashboard-adapter";
import type { StatusCount } from "./dashboard-facts";
import { OverviewBody } from "./OverviewBody";
import { refreshNote, useSnapshotRefresh, type SnapshotRead } from "./overview-refresh";
import { useOverviewCatchUp } from "./overview-catch-up";

function StatusCard({ title, fact, testId }: { title: string; fact: Fact<StatusCount[]>; testId: string }) {
  return (
    <section data-testid={testId} className="rounded-lg border border-black/10 bg-white p-3 text-sm">
      <h2 className="font-semibold text-px-ink">{title}</h2>
      {fact.state === "not_synced" ? (
        <p data-state="not_synced" className="mt-1 text-px-muted">Not on this laptop yet. It is copied while you are online.</p>
      ) : fact.value.length === 0 ? (
        <p data-state="local" className="mt-1 text-px-muted">None.</p>
      ) : (
        <ul data-state="local" className="mt-1 space-y-0.5 text-px-muted">
          {fact.value.map((s) => <li key={s.status}><span className="capitalize">{s.status.replace(/_/g, " ")}</span>: <b className="text-px-ink">{s.count}</b></li>)}
        </ul>
      )}
    </section>
  );
}

export default function Project360LocalScreen({ shell, data }: ShellScreenProps<Project360Data>) {
  const reads: SnapshotRead[] = data.state === "local" ? [{ name: boqAnalysisSnapshotName(data.projectId), url: boqAnalysisUrl(data.projectId), validate: isBoqAnalysisBody }] : [];
  const status = useSnapshotRefresh(shell, reads);
  // the status counts below are counted from the laptop's copy: keep the open project's copy current while this is on screen
  useOverviewCatchUp(shell, data.state === "local" ? data.projectId : null);
  const project = shell.data.projects.find((p) => p.id === shell.projectId);

  if (data.state === "no_project") {
    return (
      <section data-testid="overview-project360" data-state="no_project">
        <h1 className="font-heading text-2xl text-px-ink">Project 360 Analysis</h1>
        <p className="mt-3 text-sm text-px-muted">There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here.</p>
      </section>
    );
  }
  const snap = data.snapshot;
  const note = refreshNote(status, Boolean(snap));
  return (
    <section data-testid="overview-project360" data-state="local" className="space-y-4">
      <h1 className="font-heading text-2xl text-px-ink">Project 360 Analysis{project ? ` / ${project.name}` : ""}</h1>
      <section className="rounded-lg border border-black/10 bg-white p-4" data-testid="overview-project360-margin">
        <h2 className="text-sm font-semibold text-px-ink">Margin, cost and profit (worked out by the server)</h2>
        {snap ? (
          <div data-state="snapshot" className="mt-2 space-y-2">
            <p className="text-xs text-px-muted" data-testid="overview-project360-asof">{asOfLabel(snap.fetchedAt)}</p>
            <OverviewBody body={snap.body.row} />
          </div>
        ) : (
          <p data-state="none" className="mt-2 text-sm text-px-muted">
            {shell.connectivity === "online" ? "Fetching the analysis from the server…" : "Not saved on this laptop yet. It is recalculated by the server when the laptop is connected."}
          </p>
        )}
        {note ? <p className="mt-2 text-xs text-px-muted">{note}</p> : null}
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard title="Change orders by status" testId="overview-project360-change-orders" fact={data.changeOrders} />
        <StatusCard title="Milestones by status" testId="overview-project360-milestones" fact={data.milestones} />
        <StatusCard title="Progress claims by status" testId="overview-project360-claims" fact={data.progressClaims} />
      </div>
      <p className="text-xs text-px-muted">Counted on this laptop from what is saved here; amounts are never added up on the laptop. Schedule slippage and the critical path are recalculated by the server when online.</p>
    </section>
  );
}
