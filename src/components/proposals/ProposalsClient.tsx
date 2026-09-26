"use client";

// PROJEXA-BUILD-002 WP-10: "Proposals and questions". Two lists of what waits for a person:
//
//   Proposals waiting for approval  what an AI or an email prepared for a project (VERIDIAN's /projects/{id}/approvals). Each shows what
//                                   would be written and what is still missing. Approve writes it, under the signed-in person, and needs
//                                   the project manager role or above (project-document-access.ts). Values still missing are asked for
//                                   here, in the card, and sent with the approval.
//   Files that wait for a person    files this browser sent to be made into projects (way 1 and way 2) whose job stopped with questions
//                                   or is ready to be confirmed. VERIDIAN has no list of jobs, so the browser remembers the hash and
//                                   name of each file it sent (document-job-memory.ts) and reads the state of each from the server here.
//
// NOTHING HERE HIDES A FAILED READ AS AN EMPTY LIST. A project whose proposals could not be read is named with the server's own sentence;
// "Nothing waits" is shown only when every read worked.
//
// REJECT IS NOT OFFERED. VERIDIAN has no reject action for these proposals, and this screen does not invent one: the button is shown off
// with that reason, in the product's "Label (reason)" form.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format-date";
import { forgetJob, listRememberedJobs, type RememberedJob } from "@/lib/document-job-memory";
import { useOrgRole } from "@/hooks/use-org-role";
import { APPROVE_ROLE_NOTE, canApproveProposal } from "@/lib/project-document-access";
import { ApprovalError, getApprovalsClient, type ApprovalsClient, type Proposal, type ProposalMissing } from "@/lib/project-approvals-client";
import { DocumentError, getFromDocumentClient, type DocJob, type FromDocumentClient } from "@/lib/project-from-document-client";

const SOURCE_WORDS: Record<string, string> = {
  email_intelligence: "Prepared from an email",
  paste_back: "Pasted back from an AI",
};

const figure = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Runs `task` over `items`, at most `limit` at a time, in order of arrival. */
async function inBatches<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

function messageOf(error: unknown): string {
  if (error instanceof ApprovalError || error instanceof DocumentError) return error.message;
  return "Something went wrong. Nothing was changed. Try again in a minute.";
}

type ProjectLoad = { name: string; proposals: Proposal[]; error: string | null };
type FileRow = { file: RememberedJob; job: DocJob | null; error: string | null };
type CardState = { answers: Record<string, string>; busy: boolean; error: string | null; missing: ProposalMissing[] | null };

export function ProposalsScreen({
  role,
  approvals,
  documents,
}: {
  role: string | null | undefined;
  approvals: ApprovalsClient;
  documents: FromDocumentClient;
}) {
  const mayApprove = canApproveProposal(role);
  const [projectFilter, setProjectFilter] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [byProject, setByProject] = useState<Record<string, ProjectLoad>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [approved, setApproved] = useState<Record<string, { boqId: string | null; lines: number }>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let list: { id: string; name: string }[] = [];
    try {
      list = await approvals.projects();
    } catch (error) {
      if (alive.current) {
        setLoadError(`Could not load your projects: ${messageOf(error)}`);
        setProjects([]);
      }
    }
    if (!alive.current) return;
    setProjects(list);
    const next: Record<string, ProjectLoad> = {};
    await inBatches(list, 3, async (project) => {
      try {
        next[project.id] = { name: project.name, proposals: await approvals.list(project.id), error: null };
      } catch (error) {
        next[project.id] = { name: project.name, proposals: [], error: messageOf(error) };
      }
    });
    if (!alive.current) return;
    setByProject(next);

    const remembered = listRememberedJobs();
    const rows: FileRow[] = [];
    await inBatches(remembered, 3, async (file) => {
      try {
        const job = await documents.job({ sha256: file.sha256 });
        if (job.state === "created" || job.state === "rejected") forgetJob(file.sha256);
        else rows.push({ file, job, error: null });
      } catch (error) {
        rows.push({ file, job: null, error: messageOf(error) });
      }
    });
    if (!alive.current) return;
    setFiles(remembered.flatMap((f) => rows.filter((r) => r.file.sha256 === f.sha256)));
    setLoading(false);
  }, [approvals, documents]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchCard = (id: string, patch: Partial<CardState>) =>
    setCards((prev) => {
      const base: CardState = prev[id] ?? { answers: {}, busy: false, error: null, missing: null };
      return { ...prev, [id]: { ...base, ...patch } };
    });

  async function approve(proposal: Proposal) {
    const state = cards[proposal.submissionId];
    const missing = state?.missing ?? proposal.missing;
    const answers = state?.answers ?? {};
    const blank = missing.filter((m) => !(answers[m.name] ?? "").trim());
    if (blank.length > 0) {
      patchCard(proposal.submissionId, { error: `Fill in ${blank.map((m) => m.label).join(", ")} first.` });
      return;
    }
    patchCard(proposal.submissionId, { busy: true, error: null });
    try {
      const params: Record<string, string> = {};
      for (const m of missing) params[m.name] = (answers[m.name] ?? "").trim();
      const result = await approvals.approve(proposal.projectId, proposal.submissionId, params);
      if (!alive.current) return;
      if (result.kind === "needs_input") {
        patchCard(proposal.submissionId, { busy: false, missing: result.missing, error: "The service needs these values before it can write the proposal." });
        return;
      }
      setApproved((prev) => ({ ...prev, [proposal.submissionId]: { boqId: result.boqId, lines: result.lineItemIds.length } }));
      patchCard(proposal.submissionId, { busy: false });
    } catch (error) {
      if (alive.current) patchCard(proposal.submissionId, { busy: false, error: messageOf(error) });
    }
  }

  const shownProjects = (projects ?? []).filter((p) => !projectFilter || p.id === projectFilter);
  const proposals = shownProjects.flatMap((p) => (byProject[p.id]?.proposals ?? []).filter((x) => !approved[x.submissionId]));
  const failedProjects = shownProjects.filter((p) => byProject[p.id]?.error);
  const decided = shownProjects.flatMap((p) => (byProject[p.id]?.proposals ?? []).filter((x) => approved[x.submissionId]));
  const readsOk = !loading && !loadError && failedProjects.length === 0;

  return (
    <div className="space-y-8" data-testid="proposals-screen">
      <section className="space-y-3" aria-labelledby="proposals-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="proposals-h" className="text-base font-semibold">Proposals waiting for approval</h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm">
              Project
              <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} data-testid="proposals-project">
                <option value="">All projects</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading} data-testid="proposals-refresh">Refresh</Button>
          </div>
        </div>

        {!mayApprove && role && <p className="text-sm text-muted-foreground" data-testid="approve-role-note">{APPROVE_ROLE_NOTE}</p>}
        {loading && <p className="text-sm text-muted-foreground" aria-busy="true">Loading the proposals of your projects.</p>}
        {loadError && <p className="text-sm text-px-error" role="alert" data-testid="proposals-load-error">{loadError}</p>}
        {failedProjects.map((p) => (
          <p key={p.id} className="text-sm text-px-error" role="alert" data-testid="proposals-project-error">
            Could not read the proposals of {p.name}: {byProject[p.id].error}
          </p>
        ))}
        {readsOk && proposals.length === 0 && decided.length === 0 && <p className="text-sm text-muted-foreground" data-testid="proposals-empty">Nothing waits for approval.</p>}

        <ul className="space-y-3">
          {proposals.map((proposal) => {
            const card = cards[proposal.submissionId];
            const missing = card?.missing ?? proposal.missing;
            const projectName = byProject[proposal.projectId]?.name ?? "";
            return (
              <li key={proposal.submissionId} className="space-y-3 rounded-md border border-border p-4" data-testid="proposal" data-submission={proposal.submissionId}>
                <div>
                  <p className="text-sm font-medium">{proposal.title ?? proposal.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {projectName} - {SOURCE_WORDS[proposal.source] ?? "Prepared by an AI"}{proposal.preparedAt ? `, ${formatDateTime(proposal.preparedAt)} UTC` : ""}
                  </p>
                  {proposal.note && <p className="mt-1 text-sm">{proposal.note}</p>}
                </div>
                {proposal.lineCount > 0 && (
                  <div className="space-y-1" data-testid="proposal-lines">
                    <p className="text-sm">
                      {proposal.lineCount} line item{proposal.lineCount === 1 ? "" : "s"}
                      {proposal.total !== null ? `, adding up to ${figure.format(proposal.total)}` : ""}
                    </p>
                    <ul className="space-y-0.5 text-sm text-muted-foreground">
                      {proposal.lines.map((l, i) => (
                        <li key={i}>
                          {l.itemCode ? `${l.itemCode} ` : ""}{l.description}
                          {l.quantity !== null ? ` - ${figure.format(l.quantity)}${l.unit ? ` ${l.unit}` : ""}` : ""}
                          {l.rate !== null ? ` at ${figure.format(l.rate)}` : ""}
                        </li>
                      ))}
                      {proposal.lineCount > proposal.lines.length && <li>and {proposal.lineCount - proposal.lines.length} more</li>}
                    </ul>
                  </div>
                )}
                {missing.length > 0 && (
                  <div className="space-y-2" data-testid="proposal-missing">
                    <p className="text-sm font-medium">Still needed before it can be written</p>
                    {missing.map((m) => (
                      <label key={m.name} className="flex flex-col gap-1 text-sm">
                        {m.label}
                        {m.options.length > 0 ? (
                          <select
                            className="h-9 rounded-md border border-input bg-transparent px-2"
                            value={card?.answers[m.name] ?? ""}
                            onChange={(e) => patchCard(proposal.submissionId, { answers: { ...(card?.answers ?? {}), [m.name]: e.target.value } })}
                            data-testid="proposal-answer"
                            data-name={m.name}
                          >
                            <option value="">Choose</option>
                            {m.options.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            value={card?.answers[m.name] ?? ""}
                            onChange={(e) => patchCard(proposal.submissionId, { answers: { ...(card?.answers ?? {}), [m.name]: e.target.value } })}
                            data-testid="proposal-answer"
                            data-name={m.name}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}
                {card?.error && <p className="text-sm text-px-error" role="alert" data-testid="proposal-error">{card.error}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" disabled={!mayApprove || card?.busy === true} onClick={() => void approve(proposal)} data-testid="proposal-approve">
                    {card?.busy ? "Approving" : "Approve"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled title="VERIDIAN has no reject action for these proposals yet" data-testid="proposal-reject">
                    Reject (not available yet)
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        {decided.map((proposal) => {
          const done = approved[proposal.submissionId];
          return (
            <p key={proposal.submissionId} className="text-sm" role="status" data-testid="proposal-approved">
              Approved: {proposal.title ?? proposal.label}. {done.lines} line item{done.lines === 1 ? "" : "s"} written.{" "}
              {done.boqId && <Link className="underline" href={`/scope/${encodeURIComponent(done.boqId)}`}>Open the BOQ</Link>}
            </p>
          );
        })}
      </section>

      <section className="space-y-3" aria-labelledby="files-h">
        <h2 id="files-h" className="text-base font-semibold">Files that wait for a person</h2>
        <p className="text-sm text-muted-foreground">Files sent from this browser to be made into projects. Open one to read its questions and finish it.</p>
        {!loading && files.length === 0 && <p className="text-sm text-muted-foreground" data-testid="files-empty">No file sent from this browser is waiting.</p>}
        <ul className="space-y-2">
          {files.map(({ file, job, error }) => (
            <li key={file.sha256} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3" data-testid="waiting-file" data-state={job?.state ?? "unknown"}>
              <div>
                <p className="text-sm font-medium">{file.fileName}</p>
                <p className="text-xs text-muted-foreground" data-testid="waiting-file-state">
                  {error
                    ? `Could not read its state: ${error}`
                    : job?.state === "needs_answers"
                      ? `${job.questions.length} question${job.questions.length === 1 ? "" : "s"} need a person`
                      : job?.state === "ready"
                        ? "Read and checked, waiting for you to create the project"
                        : "Still being read"}
                </p>
              </div>
              <Link className="text-sm font-medium underline" href={`/projects/from-file?job=${file.sha256}`} data-testid="waiting-file-open">Open</Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function ProposalsClient() {
  const { role } = useOrgRole();
  return <ProposalsScreen role={role} approvals={getApprovalsClient()} documents={getFromDocumentClient()} />;
}
