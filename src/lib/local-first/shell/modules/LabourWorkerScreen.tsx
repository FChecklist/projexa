"use client";

// LOCAL-FIRST shell, one worker (/labour/:id) and their attendance, from the laptop's own copy. Editing a worker (name, rate,
// deactivate) is done online: the rate is money, and update_roster_entry is not wired offline (see the package report).

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Money, Num, Screen, StateMessage, Waiting, withProject } from "./DeliveryParts";
import type { WorkerData } from "./labour-adapter";
import { statusWord } from "./LabourScreen";

export default function LabourWorkerScreen({ data }: ShellScreenProps<WorkerData>) {
  const back = { href: "/labour", label: "Back to Labour" };
  if (data.state !== "local") return <StateMessage testId="labour-worker" title="Worker" state={data.state} what="worker" back={back} />;
  const w = data.worker;
  return (
    <Screen testId="labour-worker" state="local" title={w.name}>
      <CopyNote testId="labour-worker-copy-note" syncedAt={data.syncedAt} />
      <dl className="mt-4 grid max-w-xl grid-cols-[10rem_1fr] gap-y-2 rounded-lg border border-black/10 bg-white p-4 text-sm">
        <dt className="text-px-muted">ID</dt><dd>{w.employeeCode ?? DASH}</dd>
        <dt className="text-px-muted">Trade</dt><dd className="capitalize">{w.trade ?? DASH}</dd>
        <dt className="text-px-muted">Skill</dt><dd>{w.skillLevel ?? DASH}</dd>
        <dt className="text-px-muted">Daily Rate</dt><dd><Money value={w.dailyRate} hidden={data.rateHidden} /></dd>
        <dt className="text-px-muted">Status</dt><dd>{w.isActive ? "Active" : "Inactive"}</dd>
      </dl>
      <p className="mt-3 text-sm">
        <a className="text-px-ink underline underline-offset-2" href={withProject(`/labour/attendance/new?rosterId=${encodeURIComponent(w.id)}`, data.projectId)}>Mark attendance</a>
      </p>
      <h2 className="mt-6 font-heading text-lg text-px-ink">Attendance</h2>
      {data.attendance === null ? (
        <p className="mt-2 text-sm text-px-muted">Attendance has not finished copying to this laptop yet.</p>
      ) : data.attendance.length === 0 ? (
        <p className="mt-2 text-sm text-px-muted">No attendance marked for this worker yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.attendance.map((m) => (
                <TableRow key={m.id} data-testid="labour-worker-attendance-row">
                  <TableCell>{m.date}<Waiting on={m.waiting} /></TableCell>
                  <TableCell>{statusWord(m.status)}</TableCell>
                  <TableCell className="text-right"><Num value={m.hoursWorked} /></TableCell>
                  <TableCell className="text-right"><Money value={m.dailyCost} hidden={data.costHidden} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/labour", data.projectId)}>Back to Labour</a></p>
    </Screen>
  );
}
