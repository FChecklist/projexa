"use client";

// LOCAL-FIRST shell, one schedule task (/schedule/tasks/:id): its stored facts, the online screen's own arithmetic on them, its parent,
// sub-tasks and milestone. Read-only here: the online task page already queues its own edits through the outbox (local-writes.ts
// updateTaskLocally) when local-first is on; the status NAME is not on the laptop (only its id), so the status is not shown.

import { formatDurationDays } from "@/lib/schedule-progress";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Num, Screen, StateMessage, withProject } from "./DeliveryParts";
import type { ScheduleTaskData } from "./schedule-adapter";

export default function ScheduleTaskScreen({ data }: ShellScreenProps<ScheduleTaskData>) {
  if (data.state !== "local") return <StateMessage testId="schedule-task" title="Task" state={data.state} what="task" back={{ href: "/schedule", label: "Back to Schedule" }} />;
  const t = data.task;
  const p = data.projectId;
  return (
    <Screen testId="schedule-task" state="local" title={`${t.number !== null ? `#${t.number} ` : ""}${t.title}`}>
      <CopyNote testId="schedule-task-copy-note" syncedAt={data.syncedAt} />
      <dl className="mt-4 grid max-w-xl grid-cols-[10rem_1fr] gap-y-2 rounded-lg border border-black/10 bg-white p-4 text-sm">
        <dt className="text-px-muted">Start</dt><dd>{t.startDate ?? DASH}</dd>
        <dt className="text-px-muted">Due</dt><dd>{t.dueDate ?? DASH}</dd>
        <dt className="text-px-muted">Duration</dt><dd>{formatDurationDays(t.duration)}</dd>
        <dt className="text-px-muted">% Complete</dt><dd><Num value={t.completionPercentage} suffix="%" /></dd>
        <dt className="text-px-muted">Planned %</dt><dd><Num value={t.plannedPercent} suffix="%" /></dd>
        <dt className="text-px-muted">Slippage</dt><dd>{t.slippage.text}</dd>
        <dt className="text-px-muted">Priority</dt><dd className="capitalize">{t.priority ?? DASH}</dd>
        <dt className="text-px-muted">Milestone</dt><dd>{data.milestone ? `${data.milestone.name}${data.milestone.targetDate ? ` · ${data.milestone.targetDate}` : ""}` : DASH}</dd>
        <dt className="text-px-muted">Part of</dt><dd>{data.parent ? <a className="underline-offset-2 hover:underline" href={withProject(`/schedule/tasks/${encodeURIComponent(data.parent.id)}`, p)}>{data.parent.title}</a> : DASH}</dd>
      </dl>
      {t.description ? <p className="mt-3 max-w-xl whitespace-pre-wrap text-sm">{t.description}</p> : null}
      {data.children.length > 0 ? (
        <>
          <h2 className="mt-6 font-heading text-lg text-px-ink">Sub-tasks</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.children.map((c) => (
              <li key={c.id}><a className="underline-offset-2 hover:underline" href={withProject(`/schedule/tasks/${encodeURIComponent(c.id)}`, p)}>{c.title}</a> · {c.startDate ?? DASH} → {c.dueDate ?? DASH}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-3 text-sm text-px-muted">Critical path and float are recalculated when online. Changes to this task are made from the full task page.</p>
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/schedule", p)}>Back to Schedule</a></p>
    </Screen>
  );
}
