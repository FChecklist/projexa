"use client";

// LOCAL-FIRST shell, Schedule (/schedule): the Timeline from the tasks' STORED dates (a plain bar per task on the project's own date
// range), the online Timeline's browser arithmetic (duration, planned %, slippage), and the milestones. The critical path and float
// are the server's (they need the dependency graph): "recalculated when online". Board, phases and time are online for now.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDurationDays } from "@/lib/schedule-progress";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Num, Screen, ServerOnly, StateMessage, Tabs, projectName, withProject } from "./DeliveryParts";
import type { ScheduleData } from "./schedule-adapter";

const TABS = [
  { id: "timeline", label: "Timeline" },
  { id: "milestones", label: "Milestones" },
  { id: "board", label: "Board" },
  { id: "sprints", label: "Phases" },
  { id: "timesheet", label: "Time" },
] as const;

export default function ScheduleScreen({ shell, query, data }: ShellScreenProps<ScheduleData>) {
  if (data.state !== "local") return <StateMessage testId="schedule" title="Schedule" state={data.state} what="task" />;
  const name = projectName(shell, data.projectId);
  const tab = TABS.some((t) => t.id === query.get("tab")) ? query.get("tab")! : "timeline";
  const p = data.projectId;

  return (
    <Screen testId="schedule" state="local" title={`Schedule${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="schedule-copy-note" syncedAt={data.syncedAt} />
      <Tabs tabs={TABS} active={tab} base="/schedule" projectId={p} />
      {tab === "timeline" ? (
        <>
          <p className="mt-3 text-xs text-px-muted" data-testid="schedule-critical-note">
            Bars are drawn from the dates saved on this laptop. The critical path and float are recalculated when online.
            {data.baselines && data.baselines.length > 0 ? ` Baselines on file: ${data.baselines.map((b) => b.name).join(", ")} (comparison is online).` : ""}
          </p>
          {data.rows.length === 0 ? (
            <p className="mt-4 text-sm text-px-muted">No task in this project&apos;s schedule yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Planned %</TableHead>
                    <TableHead className="text-right">% Complete</TableHead>
                    <TableHead>Slippage</TableHead>
                    <TableHead className="min-w-[16rem]">{data.range ? `${data.range.start} → ${data.range.end}` : "Timeline"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((t) => (
                    <TableRow key={t.id} data-testid="schedule-row">
                      <TableCell style={{ paddingLeft: `${0.5 + t.depth * 1.25}rem` }}>
                        <a className="underline-offset-2 hover:underline" href={withProject(`/schedule/tasks/${encodeURIComponent(t.id)}`, p)}>{t.title}</a>
                        {t.milestone ? <span className="ml-1 text-xs text-px-muted">◆ milestone</span> : null}
                      </TableCell>
                      <TableCell>{t.startDate ?? DASH}</TableCell>
                      <TableCell>{t.dueDate ?? DASH}</TableCell>
                      <TableCell className="text-right">{formatDurationDays(t.duration)}</TableCell>
                      <TableCell className="text-right"><Num value={t.plannedPercent} suffix="%" /></TableCell>
                      <TableCell className="text-right"><Num value={t.completionPercentage} suffix="%" /></TableCell>
                      <TableCell className={t.slippage.tone === "behind" ? "text-red-800" : ""}>{t.slippage.glyph ? `${t.slippage.glyph} ` : ""}{t.slippage.text}</TableCell>
                      <TableCell>
                        {t.bar ? (
                          <div className="relative h-3 w-full rounded bg-black/5" aria-hidden="true">
                            <div className="absolute top-0 h-3 rounded bg-px-ink/30" style={{ left: `${t.bar.left}%`, width: `${t.bar.width}%` }} data-testid="schedule-bar">
                              <div className="h-3 rounded bg-px-ink" style={{ width: `${Math.max(0, Math.min(100, t.completionPercentage ?? 0))}%` }} />
                            </div>
                          </div>
                        ) : <span className="text-xs text-px-muted">No dates</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : tab === "milestones" ? (
        data.milestones === null ? (
          <p className="mt-4 text-sm text-px-muted">Milestones have not finished copying to this laptop yet.</p>
        ) : data.milestones.length === 0 ? (
          <p className="mt-4 text-sm text-px-muted">No milestones in this project yet.</p>
        ) : (
          <ul className="mt-4 space-y-1 text-sm" data-testid="schedule-milestones">
            {data.milestones.map((m) => <li key={m.id}>{m.targetDate ?? DASH} · {m.name}{m.status ? ` · ${m.status}` : ""}</li>)}
          </ul>
        )
      ) : (
        <div className="mt-4" data-testid={`schedule-${tab}`}>
          <p className="text-sm text-px-muted">{tab === "board" ? "The board needs the status list, which is not on this laptop yet." : tab === "sprints" ? "Phases are not on this laptop yet." : "Time entries are shown online for now."}</p>
          <ServerOnly shell={shell} what="" path="/schedule" />
        </div>
      )}
    </Screen>
  );
}
