"use client";

// PROJEXA-BUILD-002 WP-10. What a person sees of a file that was sent to be made into a project: the progress while it is read, then (when it
// stops) the result of the deterministic reader with the control totals, the questions that need a person, and the one confirm that creates
// the project. Used by the upload screen and by the chat attach control, so both show the same facts in the same words.
//
// THE FACTS COME FROM THE SERVER'S JOB. Nothing here computes a total or decides whether a file is acceptable: the sums, the shortfall or
// excess and the questions are the server's, shown as they arrive. What this panel adds is the order of the choices and the reason a button
// is off:
//   * a file with open questions is created without the lines they are about only after the person ticks that they read them;
//   * a shortfall (the lines add up to less than the file prints) needs its own tick;
//   * an excess (more than the file prints) offers no create button at all, because the server never creates from it.
// The server refuses a shortfall at the first read, before it parks the job (extraction_total_mismatch); that refusal is shown here with
// the one way forward, "read it again and accept the shortfall".
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentPhase } from "@/hooks/use-document-job";
import type { DocJob, DocQuestion, DocReconciliation } from "@/lib/project-from-document-client";

const figure = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const fmt = (v: number | null) => (v === null ? "not printed" : figure.format(v));

const STATE_WORDS: Record<string, string> = {
  received: "The file was received and is waiting to be read.",
  reading: "Reading the file. This takes a few seconds for a workbook the fixed rules can read, and up to two minutes when a model is needed.",
};

const QUESTION_KIND: Record<string, string> = {
  no_rate: "No rate",
  packed_cell: "Several lines in one cell",
  packed_sheet: "Several bills in one sheet",
  bad_quantity: "Quantity not a number",
  lump_sum: "Lump sum",
  unknown_bill: "Bill not recognised",
  missing_information: "Missing information",
  unclear: "Unclear",
};

const SOURCE_WORDS: Record<DocReconciliation["source"], string> = {
  reader: "read by the fixed rules of the workbook reader",
  model: "read with an AI model and checked against the totals in the file",
  none: "the file prints no total to check against",
};

const STATUS_WORDS: Record<DocReconciliation["status"], string> = {
  matched: "The lines add up to what the file prints.",
  shortfall: "The lines add up to less than the file prints.",
  excess: "The lines add up to more than the file prints.",
  not_checked: "The file prints no total, so the lines could not be checked.",
};

export type CreateChoice = { acknowledgeQuestions: boolean; acknowledgeShortfall: boolean };

function Totals({ rec }: { rec: DocReconciliation }) {
  return (
    <div className="space-y-1.5" data-testid="doc-totals">
      <p className="text-sm font-medium">Control totals</p>
      <p className="text-sm text-muted-foreground">{STATUS_WORDS[rec.status]} ({SOURCE_WORDS[rec.source]}.)</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Area</th>
            <th className="py-1 pr-3 text-right font-medium">The file prints</th>
            <th className="py-1 pr-3 text-right font-medium">The lines add up to</th>
            <th className="py-1 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          <tr data-testid="doc-total-row" data-area="all">
            <td className="py-1 pr-3">All areas</td>
            <td className="py-1 pr-3 text-right tabular-nums">{fmt(rec.expected)}</td>
            <td className="py-1 pr-3 text-right tabular-nums">{fmt(rec.actual)}</td>
            <td className="py-1 text-right tabular-nums">{fmt(rec.difference)}</td>
          </tr>
          {rec.byArea.map((a) => (
            <tr key={a.area} data-testid="doc-total-row" data-area={a.area}>
              <td className="py-1 pr-3">{a.area}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{fmt(a.expected)}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{fmt(a.actual)}</td>
              <td className="py-1 text-right tabular-nums">{fmt(a.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Questions({ questions }: { questions: DocQuestion[] }) {
  return (
    <div className="space-y-1.5" data-testid="doc-questions">
      <p className="text-sm font-medium">{questions.length === 1 ? "1 question needs a person" : `${questions.length} questions need a person`}</p>
      <ol className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-sm">
        {questions.map((q, i) => (
          <li key={`${q.sheet}-${q.row}-${i}`} className="flex flex-col gap-0.5 border-b border-border pb-1 last:border-b-0 last:pb-0" data-testid="doc-question">
            <span className="text-xs text-muted-foreground">
              {QUESTION_KIND[q.kind] ?? "Question"} - sheet {q.sheet}, row {q.row}
            </span>
            <span>{q.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The choices and the create button of a parked job. `state` is needs_answers or ready. */
function ParkedResult({ job, busy, onCreate, projectNameSlot }: { job: DocJob; busy: boolean; onCreate: (choice: CreateChoice) => void; projectNameSlot?: React.ReactNode }) {
  const ids = useId();
  const [readQuestions, setReadQuestions] = useState(false);
  const [acceptShortfall, setAcceptShortfall] = useState(false);
  const rec = job.reconciliation;
  const hasQuestions = job.questions.length > 0;
  const excess = rec?.status === "excess";
  const shortfall = rec?.status === "shortfall";

  let reason: string | null = null;
  if (excess) reason = "The lines add up to more than the file prints, so no project can be made from this file. Correct the file and send it again.";
  else if (hasQuestions && !readQuestions) reason = "Tick that you read the questions to create the project without the lines they are about.";
  else if (shortfall && !acceptShortfall) reason = "Tick that you accept the lines adding up to less than the file prints, or correct the file and send it again.";

  return (
    <div className="space-y-4" data-testid="doc-parked" data-state={job.state}>
      <p className="text-sm">
        {job.state === "ready"
          ? "The file was read and checked. Nothing has been created yet."
          : "The file was read and checked, but a person has to answer first. Nothing has been created yet."}
      </p>
      {job.stats && (
        <p className="text-sm text-muted-foreground" data-testid="doc-stats">
          Read {job.stats.sheets} sheet{job.stats.sheets === 1 ? "" : "s"}, {job.stats.rows} row{job.stats.rows === 1 ? "" : "s"}, {job.stats.lines} BOQ line{job.stats.lines === 1 ? "" : "s"}.
        </p>
      )}
      {rec && <Totals rec={rec} />}
      {hasQuestions && <Questions questions={job.questions} />}
      {projectNameSlot}
      {!excess && (
        <div className="space-y-2">
          {hasQuestions && (
            <label className="flex items-start gap-2 text-sm" htmlFor={`${ids}-q`}>
              <input id={`${ids}-q`} type="checkbox" className="mt-0.5" checked={readQuestions} onChange={(e) => setReadQuestions(e.target.checked)} data-testid="doc-ack-questions" />
              <span>I read the questions. Create the project without the lines they are about.</span>
            </label>
          )}
          {shortfall && (
            <label className="flex items-start gap-2 text-sm" htmlFor={`${ids}-s`}>
              <input id={`${ids}-s`} type="checkbox" className="mt-0.5" checked={acceptShortfall} onChange={(e) => setAcceptShortfall(e.target.checked)} data-testid="doc-ack-shortfall" />
              <span>The lines add up to less than the file prints. Create the BOQ as it is.</span>
            </label>
          )}
        </div>
      )}
      {reason && <p className="text-sm text-muted-foreground" data-testid="doc-create-reason">{reason}</p>}
      {!excess && (
        <Button type="button" disabled={busy || reason !== null} onClick={() => onCreate({ acknowledgeQuestions: hasQuestions && readQuestions, acknowledgeShortfall: shortfall && acceptShortfall })} data-testid="doc-create">
          Create the project
        </Button>
      )}
    </div>
  );
}

export function DocumentJobPanel({
  phase,
  onCreate,
  onReset,
  onAcceptShortfall,
  projectHref,
  projectNameSlot,
}: {
  phase: DocumentPhase;
  onCreate: (choice: CreateChoice) => void;
  onReset: () => void;
  /** Reads the same file again with the shortfall accepted. Offered only after the server refused a shortfall. */
  onAcceptShortfall?: () => void;
  projectHref: (projectId: string) => string;
  /** The optional project name field of the screen, shown above the confirm. */
  projectNameSlot?: React.ReactNode;
}) {
  if (phase.kind === "idle") return null;

  if (phase.kind === "sending") {
    return <p role="status" className="text-sm text-muted-foreground" data-testid="doc-status">Sending {phase.fileName || "the file"}.</p>;
  }

  if (phase.kind === "reading") {
    return (
      <p role="status" className="text-sm text-muted-foreground" data-testid="doc-status" data-state={phase.state}>
        {STATE_WORDS[phase.state] ?? "Reading the file."}
      </p>
    );
  }

  if (phase.kind === "parked") {
    return <ParkedResult job={phase.job} busy={false} onCreate={onCreate} projectNameSlot={projectNameSlot} />;
  }

  if (phase.kind === "created") {
    return (
      <div className="space-y-2" role="status" data-testid="doc-created">
        <p className="text-sm font-medium">
          {phase.duplicate ? "This exact file already made a project. Nothing new was created." : "The project was created from the file."}
        </p>
        {phase.job?.stats && (
          <p className="text-sm text-muted-foreground">
            {phase.job.stats.lines} BOQ line{phase.job.stats.lines === 1 ? "" : "s"} from {phase.job.stats.sheets} sheet{phase.job.stats.sheets === 1 ? "" : "s"}.
          </p>
        )}
        {phase.job?.reconciliation && phase.job.reconciliation.status !== "not_checked" && <Totals rec={phase.job.reconciliation} />}
        <a className="text-sm font-medium underline" href={projectHref(phase.projectId)} data-testid="doc-open-project">Open the project</a>
      </div>
    );
  }

  const canAccept = onAcceptShortfall && phase.code === "extraction_total_mismatch" && /less than/i.test(phase.message);
  return (
    <div className="space-y-2" role="alert" data-testid="doc-failed" data-code={phase.code ?? ""}>
      <p className="text-sm font-medium">{phase.message}</p>
      {phase.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground" data-testid="doc-issues">
          {phase.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <Button type="button" variant="outline" size="sm" onClick={onAcceptShortfall} data-testid="doc-accept-shortfall">
            Accept the shortfall and read the file again
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onReset} data-testid="doc-reset">
          Choose another file
        </Button>
      </div>
    </div>
  );
}
