"use client";

// LOCAL-FIRST shell, Mark attendance (/labour/attendance/new): one worker, one day, kept on the laptop at once and sent through the
// registry's record_attendance when the laptop is connected. The day's cost is the server's (from the worker's rate): not shown here.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { localDay } from "./delivery-local";
import { ATTENDANCE_STATUSES, markAttendanceOffline, type AttendanceStatus } from "./delivery-writes";
import { CopyNote, SaveNote, Screen, StateMessage, fieldClass, projectName, textHandlers, useLocalSave, withProject } from "./DeliveryParts";
import type { LabourData } from "./labour-adapter";
import { statusWord } from "./LabourScreen";

export default function LabourAttendanceNewScreen({ shell, query, data }: ShellScreenProps<LabourData>) {
  const active = data.state === "local" ? data.workers.filter((w) => w.isActive) : [];
  const wanted = query.get("rosterId");
  const [rosterId, setRosterId] = useState(active.some((w) => w.id === wanted) ? wanted! : "");
  const [date, setDate] = useState(localDay());
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [hours, setHours] = useState("");
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="labour-attendance-new" title="Mark attendance" state={data.state} what="worker" />;
  const name = projectName(shell, data.projectId);
  const projectId = data.projectId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const h = hours.trim() === "" ? null : Number(hours);
    const ok = await save(() => markAttendanceOffline(shell.data, { projectId, rosterId, date, status, hours: h }));
    if (ok) setHours("");
  }

  return (
    <Screen testId="labour-attendance-new" state="local" title={`Mark attendance${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="labour-attendance-new-copy-note" syncedAt={data.syncedAt} />
      {active.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">There is no active worker on this project&apos;s roster on this laptop.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="labour-attendance-form">
          <label className="block text-sm">
            Worker
            <select aria-label="Worker" className={fieldClass} value={rosterId} onChange={(e) => setRosterId(e.target.value)} required>
              <option value="">Choose a worker</option>
              {active.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.trade ? ` · ${w.trade}` : ""}</option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Date
            <input aria-label="Date" type="date" className={fieldClass} value={date} {...textHandlers(setDate)} required />
          </label>
          <label className="mt-3 block text-sm">
            Status
            <select aria-label="Status" className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus)}>
              {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{statusWord(s)}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Hours (optional)
            <input aria-label="Hours" className={fieldClass} inputMode="decimal" value={hours} {...textHandlers(setHours)} />
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save attendance"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/labour?tab=attendance", projectId)}>Back to attendance</a></p>
    </Screen>
  );
}
