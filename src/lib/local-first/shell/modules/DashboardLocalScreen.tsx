"use client";

// LOCAL-FIRST shell, overview cluster: the DASHBOARD on this laptop. Opens instantly offline from the laptop's own database
// (dashboard-adapter.ts): the person's projects and how much of each is copied, the sync state, the edits waiting to be sent and what
// needs the person, the non-money facts of the selected project, and the server's own project figures as last saved here.
//
// Money, budgets, valuation and progress-by-value are the SERVER's figures only: shown from the snapshot "As of ..., from this laptop",
// or "worked out by the server when you are online" when there is none. Nothing on this screen computes one.

import { useEffect, useState } from "react";
import { OutboxAttention } from "@/components/OutboxAttention";
import { formatAmount } from "@/lib/boq-helpers";
import { formatDateTime } from "@/lib/format-date";
import { WORKING_LOCALLY_TEXT } from "../../connectivity";
import type { Outbox } from "../../outbox";
import type { ShellScreenProps } from "../types";
import { asOfLabel } from "../snapshot-cache";
import { projectDashboardFor, projectDashboardSnapshotName, projectDashboardUrl, type DashboardData, type Fact } from "./dashboard-adapter";
import type { StatusCount } from "./dashboard-facts";
import { refreshNote, useSnapshotRefresh, type SnapshotRead } from "./overview-refresh";

function Card({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="rounded-lg border border-black/10 bg-white p-4">
      <h2 className="text-sm font-semibold text-px-ink">{title}</h2>
      <div className="mt-2 text-sm text-px-muted">{children}</div>
    </section>
  );
}

const NOT_COPIED = "Not on this laptop yet. It is copied while you are online.";

function FactCard<T>({ title, fact, testId, render }: { title: string; fact: Fact<T> | undefined; testId: string; render: (v: T) => React.ReactNode }) {
  return (
    <Card title={title} testId={testId}>
      {!fact || fact.state === "not_synced" ? <p data-state="not_synced">{NOT_COPIED}</p> : <div data-state="local">{render(fact.value)}</div>}
    </Card>
  );
}

function StatusList({ rows, none }: { rows: StatusCount[]; none: string }) {
  if (rows.length === 0) return <p>{none}</p>;
  return (
    <ul className="space-y-0.5">
      {rows.map((r) => (
        <li key={r.status}><span className="capitalize">{r.status.replace(/_/g, " ")}</span>: <b className="text-px-ink">{r.count}</b></li>
      ))}
    </ul>
  );
}

const figure = (n: number | null, kind: "percent" | "amount" | "count") =>
  n === null ? "Not set" : kind === "percent" ? `${Math.round(n * 10) / 10}%` : kind === "amount" ? formatAmount(n) : String(n);

/** The outbox of this person, only if this tab already has one (peek never creates one, so nothing is sent from here). */
function usePeekedOutbox(userId: string): Outbox | null {
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("../../outbox-shared").then((m) => {
      if (!cancelled) setOutbox(m.peekSharedOutbox(userId));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);
  return outbox;
}

export default function DashboardLocalScreen({ shell, data }: ShellScreenProps<DashboardData>) {
  const project = shell.data.projects.find((p) => p.id === data.projectId);
  const reads: SnapshotRead[] = data.projectId
    ? [{ name: projectDashboardSnapshotName(data.projectId), url: projectDashboardUrl(data.projectId), validate: projectDashboardFor(data.projectId) }]
    : [];
  const status = useSnapshotRefresh(shell, reads);
  const outbox = usePeekedOutbox(shell.data.userId);
  const online = shell.connectivity === "online";
  const w = data.waiting;
  const waitingTotal = w.outbox + w.shellEdits;
  const f = data.facts;
  const snap = data.snapshot;
  const note = refreshNote(status, Boolean(snap));

  return (
    <section data-testid="overview-dashboard" className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl text-px-ink">Dashboard{project ? ` / ${project.name}` : ""}</h1>
        <p className="mt-1 text-xs text-px-muted" data-testid="overview-dashboard-sync">
          {online ? "Connected: changes are copied both ways." : WORKING_LOCALLY_TEXT}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Your projects on this laptop" testId="overview-dashboard-projects">
          {data.projects.length === 0 ? (
            <p>Your projects are not on this laptop yet. Open PROJEXA once while you are online and they will be copied here.</p>
          ) : (
            <ul className="space-y-1">
              {data.projects.map((p) => (
                <li key={p.id} data-testid="overview-dashboard-project">
                  <a className={`underline-offset-2 hover:underline ${p.id === data.projectId ? "font-semibold text-px-ink" : "text-px-ink"}`} href={`/dashboard?projectId=${encodeURIComponent(p.id)}`}>{p.name}</a>
                  {" · "}
                  {p.kindsTotal === 0 || p.kindsCopied === 0
                    ? "not copied yet"
                    : p.kindsCopied === p.kindsTotal
                      ? `fully copied${p.lastCopiedAt ? `, last ${formatDateTime(p.lastCopiedAt)}` : ""}`
                      : `${p.kindsCopied} of ${p.kindsTotal} parts copied`}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Changes made on this laptop" testId="overview-dashboard-waiting">
          {waitingTotal === 0 ? (
            <p data-state="none">Everything you did on this laptop has reached the server.</p>
          ) : (
            <div data-state="waiting" className="space-y-1">
              <p>
                <b className="text-px-ink">{waitingTotal}</b> {waitingTotal === 1 ? "change is" : "changes are"} saved here
                {online ? " and being sent." : " and will be sent when the laptop is connected. Nothing is lost."}
              </p>
              {w.conflicts > 0 ? <p data-testid="overview-dashboard-conflicts">{w.conflicts} {w.conflicts === 1 ? "needs" : "need"} you: someone else changed the same thing.</p> : null}
              {w.blocked > 0 ? <p data-testid="overview-dashboard-blocked">{w.blocked} can only be finished on the online screen.</p> : null}
            </div>
          )}
        </Card>
      </div>

      {data.projectId ? (
        <>
          <Card title="Project figures (worked out by the server)" testId="overview-dashboard-figures">
            {snap ? (
              <div data-state="snapshot">
                <p className="text-xs" data-testid="overview-dashboard-asof">{asOfLabel(snap.fetchedAt)}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
                  <dt>Progress</dt><dd className="text-px-ink">{figure(snap.body.progressPercent, "percent")}</dd>
                  {/* Hidden money is left out, never drawn as "Not set" (that would say the project HAS no budget). */}
                  {snap.body.financialsRedacted === true ? null : (
                    <>
                      <dt>% complete by BOQ value</dt><dd className="text-px-ink">{figure(snap.body.percentByValue, "percent")}</dd>
                      <dt>Contract value</dt><dd className="text-px-ink">{figure(snap.body.contractValue, "amount")}</dd>
                      <dt>Budget</dt><dd className="text-px-ink">{figure(snap.body.budget, "amount")}</dd>
                      <dt>Spent</dt><dd className="text-px-ink">{figure(snap.body.expenses, "amount")}</dd>
                    </>
                  )}
                  <dt>Delayed tasks</dt><dd className="text-px-ink">{figure(snap.body.delayedTaskCount, "count")}</dd>
                  <dt>Permits expiring</dt><dd className="text-px-ink">{figure(snap.body.permitsExpiringCount, "count")}</dd>
                </dl>
                {snap.body.financialsRedacted === true ? (
                  <p className="mt-2 text-xs" data-testid="overview-dashboard-money-hidden">Money figures are shown to managers and above.</p>
                ) : null}
              </div>
            ) : (
              <p data-state="none">Money, budgets and progress by value are worked out by the server. {online ? "" : "They will be shown here once the laptop is connected."}</p>
            )}
            {note ? <p className="mt-2 text-xs" data-testid="overview-dashboard-refresh">{note}</p> : null}
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <FactCard title="Tasks" testId="overview-fact-tasks" fact={f?.tasks} render={(t) => (
              <ul className="space-y-0.5">
                <li>Not finished: <b className="text-px-ink">{t.notFinished}</b></li>
                <li>Due this week: <b className="text-px-ink">{t.dueThisWeek}</b></li>
                <li>Overdue: <b className="text-px-ink">{t.overdue}</b></li>
              </ul>
            )} />
            <FactCard title="Activities" testId="overview-fact-activities" fact={f?.activities} render={(a) => (
              <ul className="space-y-0.5">
                <li>Not started: <b className="text-px-ink">{a.notStarted}</b></li>
                <li>In progress: <b className="text-px-ink">{a.inProgress}</b></li>
                <li>Complete: <b className="text-px-ink">{a.complete}</b></li>
              </ul>
            )} />
            <FactCard title="Milestones due this week" testId="overview-fact-milestones" fact={f?.milestonesDueThisWeek} render={(n) => <p><b className="text-px-ink">{n}</b></p>} />
            <FactCard title="RFIs by status" testId="overview-fact-rfis" fact={f?.rfis} render={(rows) => <StatusList rows={rows} none="No RFIs." />} />
            <FactCard title="Punch list by status" testId="overview-fact-punch" fact={f?.punchList} render={(rows) => <StatusList rows={rows} none="No punch items." />} />
            <FactCard title="Submittals by status" testId="overview-fact-submittals" fact={f?.submittals} render={(rows) => <StatusList rows={rows} none="No submittals." />} />
          </div>
          <p className="text-xs text-px-muted">Counted on this laptop from what is saved here. The schedule's critical path and approvals are decided by the server.</p>
        </>
      ) : null}

      {outbox ? <OutboxAttention outbox={outbox} /> : null}
    </section>
  );
}
