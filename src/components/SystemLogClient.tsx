"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildCopyReport,
  formatWhen,
  normaliseIssue,
  timelineEntries,
  type Issue,
  type TimelineEntry,
} from "@/lib/client-log/report";

// OWNER SCREEN: "Everything that went wrong while people used PROJEXA, and what was done about it".
// Reads (owner / admin only, enforced by the proxy routes under /api/client-logs):
//   GET /api/client-logs/issues?status=all   grouped problems, each with a sample report
//   GET /api/client-logs/issues/[id]         one problem + its latest sightings (used for "how many people")
//   GET /api/client-logs/timeline?projectId  one project, from start to end
// Plain words only. Technical details are one click away, never in the way.

type Loader = (url: string) => Promise<unknown>;
type Tab = "open" | "fixed" | "timeline";
type ProjectOption = { id: string; name: string };

const TIMELINE_PAGE = 200;

const defaultLoad: Loader = (url) => fetchJson(url);

export default function SystemLogClient({ load = defaultLoad }: { load?: Loader }) {
  const [tab, setTab] = useState<Tab>("open");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const loadIssues = useCallback(async () => {
    setIssuesError(null);
    try {
      const data = (await load("/api/client-logs/issues?status=all&limit=200")) as { issues?: unknown[] };
      setIssues((data.issues ?? []).map(normaliseIssue));
    } catch (err) {
      setIssues([]);
      setIssuesError(err instanceof Error ? err.message : "The list could not be loaded.");
    }
  }, [load]);

  useEffect(() => {
    void loadIssues();
    void (async () => {
      try {
        const data = (await load("/api/projects")) as { projects?: ProjectOption[] };
        setProjects((data.projects ?? []).map((p) => ({ id: p.id, name: p.name })));
      } catch {
        setProjects([]); // names are a nicety: ids are shown instead
      }
    })();
  }, [load, loadIssues]);

  const names = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const open = (issues ?? []).filter((i) => i.status === "open" || i.status === "reopened");
  const fixed = (issues ?? []).filter((i) => i.status === "fixed");

  return (
    <div className="space-y-4" data-testid="system-log">
      <div role="tablist" aria-label="System log" className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["open", `Open problems${issues ? ` (${open.length})` : ""}`],
            ["fixed", `Fixed${issues ? ` (${fixed.length})` : ""}`],
            ["timeline", "Project timeline"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === id ? "bg-background font-medium shadow-sm" : "text-px-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== "timeline" && issues === null && <p className="text-sm text-px-muted">Loading…</p>}
      {tab !== "timeline" && issuesError && (
        <div role="alert" className="rounded-lg border border-px-error-border bg-px-error-light p-3 text-sm">
          <p className="font-medium text-px-error">The list could not be loaded</p>
          <p className="text-px-error/90">{issuesError}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadIssues()}>
            Try again
          </Button>
        </div>
      )}

      {tab === "open" && issues !== null && !issuesError && (
        open.length === 0 ? (
          <Empty title="Nothing has gone wrong yet" body="When something breaks for anyone using PROJEXA, it shows up here by itself, with the steps that led to it." />
        ) : (
          <ul className="space-y-3" data-testid="open-list">
            {open.map((i) => (
              <IssueCard key={i.id} issue={i} names={names} />
            ))}
          </ul>
        )
      )}

      {tab === "fixed" && issues !== null && !issuesError && (
        fixed.length === 0 ? (
          <Empty title="No fixes recorded yet" body="When a problem is fixed, what was changed and where is written down here." />
        ) : (
          <ul className="space-y-3" data-testid="fixed-list">
            {fixed.map((i) => (
              <IssueCard key={i.id} issue={i} names={names} fixedView />
            ))}
          </ul>
        )
      )}

      {tab === "timeline" && <Timeline projects={projects} load={load} />}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center" data-testid="empty-state">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-px-muted">{body}</p>
      </CardContent>
    </Card>
  );
}

function IssueCard({ issue, names, fixedView = false }: { issue: Issue; names: Record<string, string>; fixedView?: boolean }) {
  // "How many people" comes with each issue in the list (people); when an older backend omits it the sentence simply leaves it out.
  const people = issue.people;
  const [copied, setCopied] = useState<"idle" | "ok" | "manual">("idle");
  const projectNames = issue.projectIds.map((p) => names[p] ?? `project ${p.slice(0, 8)}`);

  const report = useMemo(() => buildCopyReport(issue, { projectNames: names, people }), [issue, names, people]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied("ok");
    } catch {
      setCopied("manual"); // no clipboard permission: the text is shown to select by hand
    }
  };

  const s = issue.sample;
  return (
    <li>
      <Card data-testid="issue-card">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium" data-testid="issue-title">{issue.title}</p>
              {issue.status === "reopened" && (
                <p className="text-xs text-px-error" data-testid="came-back">This came back after it was fixed ({issue.reopenedCount} time{issue.reopenedCount === 1 ? "" : "s"}).</p>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => void copy()} data-testid="copy-report">
              {copied === "ok" ? "Copied" : "Copy report"}
            </Button>
          </div>

          <p className="text-sm text-px-muted" data-testid="issue-facts">
            Happened {issue.occurrences} time{issue.occurrences === 1 ? "" : "s"}
            {people != null && people > 0 ? `, to ${people} ${people === 1 ? "person" : "people"}` : ""}. Last seen {formatWhen(issue.lastEventAt || issue.lastSeenAt)}.
            {projectNames.length ? ` Project: ${projectNames.join(", ")}.` : ""}
          </p>

          {fixedView && (
            <div className="rounded-md bg-muted p-3 text-sm" data-testid="fix-record">
              <p className="font-medium">What was done</p>
              <p>{issue.fixSummary || "A fix was recorded without a description."}</p>
              {issue.fixFiles.length > 0 && (
                <ul className="mt-2 list-disc pl-5" data-testid="fix-files">
                  {issue.fixFiles.map((f) => (
                    <li key={f.path}>
                      <code>{f.path}</code>
                      {f.change ? <> — {f.change}</> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-px-muted" data-testid="fix-date">
                Fixed {issue.fixedAt ? formatWhen(issue.fixedAt) : "(date not recorded)"}
                {issue.fixCommit ? ` — change ${issue.fixCommit.slice(0, 8)}` : ""}.
              </p>
            </div>
          )}

          {s && s.steps.length > 0 && (
            <div>
              <p className="text-sm font-medium">What the person was doing</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm" data-testid="steps">
                {s.steps.map((st, i) => (
                  <li key={i}>{st.text}</li>
                ))}
              </ol>
            </div>
          )}

          {s && (
            <details data-testid="technical">
              <summary className="cursor-pointer text-sm text-px-muted">Technical details</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt>Message</dt><dd className="break-words">{s.message}</dd>
                <dt>Screen</dt><dd>{s.route}</dd>
                {s.apiPath && (<><dt>Server call</dt><dd>{s.httpMethod} {s.apiPath} → {s.httpStatus ?? "?"}{s.requestId ? ` (request ${s.requestId})` : ""}</dd></>)}
                {s.device && (<><dt>Device</dt><dd className="break-words">{s.device}</dd></>)}
                {s.stack && (<><dt>Stack</dt><dd><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{s.stack}</pre></dd></>)}
              </dl>
            </details>
          )}

          {copied === "manual" && (
            <div>
              <p className="text-xs text-px-muted">Copying was blocked. Select all of this text and copy it yourself.</p>
              <textarea readOnly className="mt-1 h-40 w-full rounded border p-2 font-mono text-xs" value={report} data-testid="manual-copy" onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

function Timeline({ projects, load }: { projects: ProjectOption[]; load: Loader }) {
  const [projectId, setProjectId] = useState("");
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (id: string, after?: string) => {
      setError(null);
      try {
        const qs = `projectId=${encodeURIComponent(id)}&limit=${TIMELINE_PAGE}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
        const d = (await load(`/api/client-logs/timeline?${qs}`)) as { events?: unknown[] };
        const page = timelineEntries(d.events);
        setEntries((prev) => (after && prev ? [...prev, ...page] : page));
        setMore(page.length >= TIMELINE_PAGE);
      } catch (err) {
        setEntries((prev) => prev ?? []);
        setError(err instanceof Error ? err.message : "The timeline could not be loaded.");
      }
    },
    [load]
  );

  useEffect(() => {
    if (projectId) {
      setEntries(null);
      void fetchPage(projectId);
    } else {
      setEntries(null);
    }
  }, [projectId, fetchPage]);

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mr-2 font-medium">Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border bg-background px-2 py-1" data-testid="timeline-project">
          <option value="">Choose a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      {!projectId && <p className="text-sm text-px-muted">Pick a project to see everything that happened in it, from the start to now.</p>}
      {projectId && entries === null && !error && <p className="text-sm text-px-muted">Loading…</p>}
      {error && (
        <div role="alert" className="rounded-lg border border-px-error-border bg-px-error-light p-3 text-sm text-px-error">{error}</div>
      )}
      {projectId && entries !== null && entries.length === 0 && !error && (
        <Empty title="Nothing recorded for this project yet" body="Actions and problems appear here as people work in it." />
      )}
      {entries && entries.length > 0 && (
        <ol className="divide-y rounded-lg border" data-testid="timeline-list">
          {entries.map((e) => (
            <li
              key={e.id}
              data-testid={e.isError ? "timeline-error" : "timeline-action"}
              className={`flex gap-3 px-3 py-2 text-sm ${e.isError ? "bg-px-error-light text-px-error" : ""}`}
            >
              <time className="w-40 shrink-0 text-xs text-px-muted" dateTime={e.time}>{e.time.slice(0, 16).replace("T", " ")}</time>
              <span className={e.isError ? "font-medium" : ""}>{e.isError ? "Problem: " : ""}{e.text}</span>
            </li>
          ))}
        </ol>
      )}
      {more && entries && (
        <Button size="sm" variant="outline" onClick={() => void fetchPage(projectId, entries[entries.length - 1]?.time)}>
          Show later entries
        </Button>
      )}
    </div>
  );
}
