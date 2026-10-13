"use client";

// LOCAL-FIRST shell, overview cluster: REPORTS on this laptop. The list of the online Reports screen; a report opens the server's last
// answer kept here ("As of ..., from this laptop"), refreshed from the same endpoint while the laptop is online. Export (CSV) works
// whenever that answer is on the laptop -- it is the same reportResultToCsv the online screen uses -- and otherwise says plainly that it
// needs the server once. "Copy text for WhatsApp" (R-C15) works the same way with no network: the saved answer as a short message to paste; the public
// link and the PDF are made by the server, and the screen says that in words.

import { useState } from "react";
import { formatDateTime } from "@/lib/format-date";
import { reportResultToCsv } from "@/lib/report-run";
import type { ShellScreenProps } from "../types";
import { asOfLabel, snapshotCacheFor } from "../snapshot-cache";
import { prefetchReportSnapshots } from "./reports-prefetch";
import type { ReportsData } from "./reports-adapter";
import { isReportBody } from "./reports-adapter";
import { OverviewBody, downloadText } from "./OverviewBody";
import { ServerOnly } from "./DeliveryParts";
import { copyTextToClipboard, reportShareText } from "./share-text";
import { refreshNote, useSnapshotRefresh, type SnapshotRead } from "./overview-refresh";

export default function ReportsLocalScreen({ shell, data }: ShellScreenProps<ReportsData>) {
  const selected = data.state === "local" ? data.selected : null;
  const reads: SnapshotRead[] = selected?.kind === "fetch" ? [{ name: selected.name, url: selected.url, validate: isReportBody }] : [];
  const status = useSnapshotRefresh(shell, reads);
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const online = shell.connectivity === "online";

  // Keeping EVERY report on the laptop is the person's choice (a button), never automatic: it asks the server for each report, and a daily walk of the
  // shell must stay off Vercel (e2e/lf-lifecycle-vercel-budget.spec.ts, owner directive "Vercel ~0"). One request at a time, nothing already fresh.
  const prefetchProject = data.state === "local" ? data.projectId : null;
  const prefetchReports = data.state === "local" ? data.reports.filter((r) => r.value !== selected?.value) : null;
  const [keeping, setKeeping] = useState<"idle" | "running" | "done" | "stopped">("idle");
  const [copied, setCopied] = useState<{ ok: boolean; text: string } | null>(null);
  async function keepAllReports() {
    if (!online || !prefetchProject || !prefetchReports) return;
    setKeeping("running");
    const cache = snapshotCacheFor({ userId: shell.data.userId, role: shell.data.role, idb: shell.data.idb });
    const result = await prefetchReportSnapshots({ cache, reports: prefetchReports, projectId: prefetchProject });
    setKeeping(result.stoppedBecause === "none" ? "done" : "stopped");
    shell.refresh();
  }

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
      {online ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="reports-keep-all"
            disabled={keeping === "running"}
            onClick={() => void keepAllReports()}
            className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-px-ink disabled:opacity-60"
          >
            {keeping === "running" ? "Keeping the reports on this laptop…" : "Keep all reports on this laptop"}
          </button>
          {keeping === "done" ? <span className="text-xs text-px-muted" data-testid="reports-keep-all-note">Every report is now saved here and opens offline.</span> : null}
          {keeping === "stopped" ? <span className="text-xs text-px-muted" data-testid="reports-keep-all-note">The server did not answer for every report. Those that were saved are kept; try again later.</span> : null}
        </div>
      ) : null}
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
                    <button
                      type="button"
                      data-testid="overview-report-whatsapp"
                      className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-px-ink"
                      onClick={async () => {
                        const text = reportShareText({ title: selected.label, projectName: project?.name ?? null, savedAt: snap.fetchedAt, body: snap.body });
                        setCopied({ ok: await copyTextToClipboard(text), text });
                      }}
                    >
                      Copy text for WhatsApp
                    </button>
                  </div>
                  {copied?.ok ? <p className="text-xs text-px-ink" role="status" data-testid="overview-report-copied">Copied. Paste it into WhatsApp.</p> : null}
                  {copied && !copied.ok ? (
                    <div data-testid="overview-report-copy-manual">
                      <p className="text-xs text-px-muted">This browser did not allow copying. Select the text below and copy it.</p>
                      <textarea readOnly rows={8} className="mt-1 w-full rounded border border-black/20 p-2 text-xs" value={copied.text} onFocus={(e) => e.currentTarget.select()} />
                    </div>
                  ) : null}
                  <ServerOnly shell={shell} what="A public link to this report, and its PDF, are made once you are online (the Share and Export buttons of the Reports screen). Until then, copy the text above into WhatsApp." path="/reports" />
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
