"use client";

// LOCAL-FIRST shell, overview cluster: EXCEPTIONS on this laptop -- the server's 28 checks as it last answered them for this person and
// project, "As of ..., from this laptop", refreshed from GET /api/exceptions (the online screen's endpoint) while connected. Nothing is
// re-checked on the laptop: a check's verdict and count are exactly the server's.

import type { ShellScreenProps } from "../types";
import { asOfLabel } from "../snapshot-cache";
import { exceptionsSnapshotName, exceptionsUrl, isExceptionsBody, type ExceptionsData } from "./analysis-adapter";
import { refreshNote, useSnapshotRefresh, type SnapshotRead } from "./overview-refresh";

const RECORDS_SHOWN = 10;

export default function ExceptionsLocalScreen({ shell, data }: ShellScreenProps<ExceptionsData>) {
  const reads: SnapshotRead[] = data.state === "local" ? [{ name: exceptionsSnapshotName(data.projectId), url: exceptionsUrl(data.projectId), validate: isExceptionsBody }] : [];
  const status = useSnapshotRefresh(shell, reads);
  const project = shell.data.projects.find((p) => p.id === shell.projectId);

  if (data.state === "no_project") {
    return (
      <section data-testid="overview-exceptions" data-state="no_project">
        <h1 className="font-heading text-2xl text-px-ink">Exceptions</h1>
        <p className="mt-3 text-sm text-px-muted">There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here.</p>
      </section>
    );
  }
  const snap = data.snapshot;
  const note = refreshNote(status, Boolean(snap));
  return (
    <section data-testid="overview-exceptions" data-state="local" className="space-y-3">
      <h1 className="font-heading text-2xl text-px-ink">Exceptions{project ? ` / ${project.name}` : ""}</h1>
      {snap ? (
        <div data-state="snapshot" className="space-y-2">
          <p className="text-xs text-px-muted" data-testid="overview-exceptions-asof">{asOfLabel(snap.fetchedAt)}</p>
          <ul className="space-y-2">
            {snap.body.checks.map((c) => (
              <li key={c.item} data-testid="overview-exception-check" data-flagged={c.flagged ? "1" : "0"} className="rounded-lg border border-black/10 bg-white p-3 text-sm">
                <p className="text-px-ink"><b>{c.item}.</b> {c.title} · {c.flagged ? `${c.count} flagged` : "clear"}</p>
                {c.flagged && c.records.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-px-muted">
                    {c.records.slice(0, RECORDS_SHOWN).map((r) => <li key={r.id}>{r.detail}</li>)}
                    {c.records.length > RECORDS_SHOWN ? <li>…and {c.records.length - RECORDS_SHOWN} more on the online screen.</li> : null}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p data-state="none" className="text-sm text-px-muted" data-testid="overview-exceptions-none">
          The checks are run by the server. {shell.connectivity === "online" ? "" : "They have not been saved on this laptop yet and will appear once it is connected."}
        </p>
      )}
      {note ? <p className="text-xs text-px-muted" data-testid="overview-exceptions-refresh">{note}</p> : null}
    </section>
  );
}
