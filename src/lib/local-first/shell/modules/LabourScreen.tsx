"use client";

// LOCAL-FIRST shell, Labour (/labour): the roster, the attendance list and today's head-count from the laptop's own copy. Costs are
// shown per row as the server stored them (or "hidden for your role"); the trade-wise cost summary is the server's.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { localDay } from "./delivery-local";
import { CopyNote, DASH, Money, Num, Screen, StateMessage, Tabs, Waiting, mayWrite, projectName, withProject } from "./DeliveryParts";
import type { LabourData } from "./labour-adapter";

const TABS = [
  { id: "roster", label: "Roster" },
  { id: "attendance", label: "Attendance" },
  { id: "summary", label: "Daily Summary" },
] as const;

const STATUS_WORDS: Record<string, string> = { present: "Present", half_day: "Half day", absent: "Absent" };
export const statusWord = (s: string) => STATUS_WORDS[s] ?? s;

export default function LabourScreen({ shell, query, data }: ShellScreenProps<LabourData>) {
  if (data.state !== "local") return <StateMessage testId="labour" title="Labour" state={data.state} what="worker" />;
  const name = projectName(shell, data.projectId);
  const tab = TABS.some((t) => t.id === query.get("tab")) ? query.get("tab")! : "roster";
  const today = localDay();

  return (
    <Screen testId="labour" state="local" title={`Labour${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="labour-copy-note" syncedAt={data.syncedAt} />
      {data.today ? (
        <p className="mt-2 text-sm" data-testid="labour-today">
          Today: {data.today.present} present · {data.today.halfDay} half day · {data.today.absent} absent
        </p>
      ) : null}
      <p className="mt-2 flex gap-3 text-sm">
        {mayWrite(shell) ? <a className="text-px-ink underline underline-offset-2" href={withProject("/labour/attendance/new", data.projectId)}>Mark attendance</a> : null}
        <a className="text-px-ink underline underline-offset-2" href={withProject(`/labour/attendance/${today}`, data.projectId)}>Today&apos;s sheet</a>
      </p>
      <Tabs tabs={TABS} active={tab} base="/labour" projectId={data.projectId} />

      {tab === "roster" ? (
        data.workers.length === 0 ? (
          <p className="mt-4 text-sm text-px-muted">No workers on the roster yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead className="text-right">Daily Rate</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.workers.map((w) => (
                  <TableRow key={w.id} data-testid="labour-roster-row">
                    <TableCell>{w.employeeCode ?? DASH}</TableCell>
                    <TableCell><a className="underline-offset-2 hover:underline" href={withProject(`/labour/${encodeURIComponent(w.id)}`, data.projectId)}>{w.name}</a></TableCell>
                    <TableCell className="capitalize">{w.trade ?? DASH}</TableCell>
                    <TableCell className="text-right"><Money value={w.dailyRate} hidden={data.rateHidden} /></TableCell>
                    <TableCell>{w.isActive ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : tab === "attendance" ? (
        data.attendance === null ? (
          <p className="mt-4 text-sm text-px-muted">Attendance has not finished copying to this laptop yet.</p>
        ) : data.attendance.length === 0 ? (
          <p className="mt-4 text-sm text-px-muted">No attendance marked on this project yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.attendance.map((m) => (
                  <TableRow key={m.id} data-testid="labour-attendance-row">
                    <TableCell><a className="underline-offset-2 hover:underline" href={withProject(`/labour/attendance/${m.date}`, data.projectId)}>{m.date}</a><Waiting on={m.waiting} /></TableCell>
                    <TableCell>{m.workerName ?? "A worker not on this laptop"}</TableCell>
                    <TableCell>{statusWord(m.status)}</TableCell>
                    <TableCell className="text-right"><Num value={m.hoursWorked} /></TableCell>
                    <TableCell className="text-right">{m.waiting && !data.costHidden ? "Worked out when sent" : <Money value={m.dailyCost} hidden={data.costHidden} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : (
        <div className="mt-4 text-sm" data-testid="labour-summary">
          {data.today ? (
            <p>Today ({today}): {data.today.present} present, {data.today.halfDay} half day, {data.today.absent} absent, {data.today.marked} marked of {data.workers.filter((w) => w.isActive).length} active workers.</p>
          ) : (
            <p className="text-px-muted">Attendance has not finished copying to this laptop yet.</p>
          )}
          <p className="mt-2 text-px-muted">The cost by trade is calculated by the server: recalculated when online.</p>
        </div>
      )}
    </Screen>
  );
}
