"use client";

// LOCAL-FIRST shell, overview cluster: REPORTS on this laptop. The list of the online Reports screen; a report opens the server's last
// answer kept here ("As of ..., from this laptop"), refreshed from the same endpoint while the laptop is online. Export (CSV) works
// whenever that answer is on the laptop -- it is the same reportResultToCsv the online screen uses -- and otherwise says plainly that it
// needs the server once.

import { useEffect } from "react";
import { formatDateTime } from "@/lib/format-date";
import { reportResultToCsv } from "@/lib/report-run";
import type { ShellScreenProps } from "../types";
import { asOfLabel, snapshotCacheFor } from "../snapshot-cache";
import { prefetchReportSnapshots } from "./reports-prefetch";
import type { ReportsData } from "./reports-adapter";
import { isReportBody } from "./reports-adapter";
import { OverviewBody, downloadText } from "./OverviewBody";
import { refreshNote, useSnapshotRefresh, type SnapshotRead } from "./overview-refresh";

export default function ReportsLocalScreen({ shell, data }: ShellScreenProps<ReportsData>) {
  const selected = data.state === "local" ? data.selected : null;
  const reads: SnapshotRead[] = selected?.kind === "fetch" ? [{ name: selected.name, url: selected.url, validate: isReportBody }] : [];
  const status = useSnapshotRefresh(shell, reads);
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const online = shell.connectivity === "online";

  // Keep the server's last answer for every report of this project, so all of them are here when the laptop goes offline.
  const prefetchProject = data.state === "local" ? data.projectId : null;
  // The selected report is already fetched by useSnapshotRefresh above: not asked for twice.
  const prefetchReports = data.state === "local" ? data.reports.filter((r) => r.value !== selected?.value) : null;
  useEffect(() => {
    if (!online || !prefetchProject || !prefetchReports) return;
    const controller = new AbortController();
    void (async () => {
      const cache = snapshotCacheFor({ userId: shell.data.userId, role: shell.data.role, idb: shell.data.idb });
      const result = await prefetchReportSnapshots({ cache, reports: prefetchReports, projectId: prefetchProject, signal: controller.signal });
      if (result.refreshed > 0 && !controller.signal.aborted) shell.refresh();
    })();
    return () => controller.abort();
    // Once per project per time the laptop comes online: not on every redraw (shell.refresh() redraws this screen).
  }, [online, prefetchProject, selected?.value]);

  if (data.state === "no_project") {
    return (
      <section data-testid="overview-reports" data-state="no_project">
        <h1 className="font-heading text-2xl text-px-ink">Reports</h1>
        <p className="mt-3 text-sm text-px-muted">There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here.</p>
      </section>
    );
  }

  const qs = (value: string) => `/reports?report=${encodeURIComponent(value)}&projectId=${encodeURIComponent(data.projectId)}${value === "weekly-project" && data.weekStart ? `&weekStart=${data.weekStart}` : ""}`;
  const snap = selected?.kind === "fetch" ? selected.snapshot : null;
  const note = selected?.kind === "fetch" ? refreshNote(status, Boolean(snap)) : null;

  return (
    <section data-testid="overview-reports" data-state="local" className="space-y-4">
      <h1 className="font-heading text-2xl text-px-ink">Reports{project ? ` / ${project.name}` : ""}</h1>
      <p className="text-xs text-px-muted">Reports are worked out by the server. This laptop shows the last one it received for you.</p>
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <nav aria-label="Reports" className="rounded-lg border border-black/10 bg-white p-2 text-sm">
          <ul className="space-y-1">
            {data.reports.map((r) => (
              <li key={r.value} data-testid="overview-report-entry" data-report={r.value}>
                <a href={r.kind === "navigate" ? r.target : qs(r.value)} className={`underline-offset-2 hover:underline ${selected?.value === r.value ? "font-semibold text-px-ink" : "text-px-ink"}`}>{r.label}</a>
                <span className="block text-xs text-px-muted">
                  {r.kind === "navigate" ? "Opens its own screen" : r.savedAt ? `Saved here ${formatDateTime(r.savedAt)}` : "Not saved on this laptop yet"}
                </span>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-3" data-testid="overview-report">
          {!selected ? (
            <p className="text-sm text-px-muted">Choose a report.</p>
          ) : selected.kind === "navigate" ? (
            <p className="text-sm text-px-muted">{selected.label} has its own screen: <a className="text-px-ink underline" href={selected.href}>open it</a>.</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-px-ink">{selected.label}</h2>
              {selected.value === "weekly-project" && !data.weekStart ? <p className="text-sm text-px-muted">This report needs a week start; open it with one chosen on the online Reports screen.</p> : null}
              {snap ? (
                <div data-state="snapshot" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs text-px-muted" data-testid="overview-report-asof">{asOfLabel(snap.fetchedAt)}</p>
                    <button
                      type="button"
                      data-testid="overview-report-export"
                      className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-px-ink"
                      onClick={() => downloadText(`${selected.value}.csv`, reportResultToCsv(snap.body, `${selected.label}${project ? ` - ${project.name}` : ""} (${asOfLabel(snap.fetchedAt)})`))}
                    >
                      Export CSV
                    </button>
                  </div>
                  <OverviewBody body={snap.body} />
                </div>
              ) : (
                <p data-state="none" className="text-sm text-px-muted" data-testid="overview-report-none">
                  {online
                    ? "Fetching this report from the server…"
                    : "This report has not been saved on this laptop yet. It will be fetched, and can be exported, once the laptop is connected."}
                </p>
              )}
              {note ? <p className="text-xs text-px-muted" data-testid="overview-report-refresh">{note}</p> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
