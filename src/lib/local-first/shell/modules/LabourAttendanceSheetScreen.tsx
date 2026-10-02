"use client";

// LOCAL-FIRST shell, the day's attendance sheet (/labour/attendance/:date): every active worker with that day's mark, and one tap per
// worker to mark them (each tap is one record_attendance kept on the laptop and sent when connected). The online sheet's cost
// preview and trade totals are not made here: cost is money, the server's.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { ATTENDANCE_STATUSES, markAttendanceOffline, type AttendanceStatus } from "./delivery-writes";
import { CopyNote, Money, SaveNote, Screen, StateMessage, Waiting, mayWrite, projectName, useLocalSave, withProject } from "./DeliveryParts";
import type { AttendanceSheetData } from "./labour-adapter";
import { statusWord } from "./LabourScreen";

export default function LabourAttendanceSheetScreen({ shell, data }: ShellScreenProps<AttendanceSheetData>) {
  const { saving, note, save } = useLocalSave(shell);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (data.state !== "local") return <StateMessage testId="labour-attendance-sheet" title="Attendance sheet" state={data.state} what="day" back={{ href: "/labour?tab=attendance", label: "Back to attendance" }} />;
  const name = projectName(shell, data.projectId);
  const { projectId, date } = data;
  const canMark = mayWrite(shell);

  async function mark(rosterId: string, status: AttendanceStatus) {
    setBusyId(rosterId);
    try {
      await save(() => markAttendanceOffline(shell.data, { projectId, rosterId, date, status }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen testId="labour-attendance-sheet" state="local" title={`Attendance · ${date}${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="labour-attendance-sheet-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm" data-testid="labour-sheet-counts">
        {data.counts.present} present · {data.counts.halfDay} half day · {data.counts.absent} absent · {data.rows.length - data.counts.marked} not marked
      </p>
      <SaveNote note={note} />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">There is no active worker on this project&apos;s roster on this laptop.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead>Attendance</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                {canMark ? <TableHead>Mark</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(({ worker, mark: m }) => (
                <TableRow key={worker.id} data-testid="labour-sheet-row">
                  <TableCell>{worker.name}</TableCell>
                  <TableCell className="capitalize">{worker.trade ?? ""}</TableCell>
                  <TableCell>{m ? statusWord(m.status) : "Not marked"}<Waiting on={Boolean(m?.waiting)} /></TableCell>
                  <TableCell className="text-right">{m && !m.waiting ? <Money value={m.dailyCost} hidden={data.costHidden} /> : ""}</TableCell>
                  {canMark ? (
                    <TableCell className="space-x-1 whitespace-nowrap">
                      {ATTENDANCE_STATUSES.map((s) => (
                        <Button key={s} type="button" size="sm" variant={m?.status === s ? "default" : "outline"} disabled={saving || busyId === worker.id} onClick={() => void mark(worker.id, s)}>
                          {statusWord(s)}
                        </Button>
                      ))}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/labour?tab=attendance", projectId)}>Back to attendance</a></p>
    </Screen>
  );
}
