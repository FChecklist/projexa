"use client";

// Real-screen conversion (2026-08-30): replaces LabourClient.tsx's old
// "Mark Attendance" Dialog popup with a real create screen. No Object Page
// -- a daily attendance row is a write-once transaction (dailyCost computed
// server-side at write time from the roster entry's own dailyRate), same
// class as Expenses/Stock Entries.
//
// R67 D-67: onto the shared archetype. The roster read's failure was a
// toast, so the Worker select had no options and the primary sat disabled
// naming "Worker" as missing -- the form blaming a site supervisor for a
// backend failure. It now says what happened, offers Retry, and the reason
// names the real cause.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { PaneErrorCard } from "@/components/PaneState";
import { fetchJson, errorMessage, ApiError } from "@/lib/fetch-json";
import type { CreateField } from "@/lib/create-screen";

type RosterEntry = { id: string; name: string; isActive: boolean };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendanceCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterError, setRosterError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ attendanceDate: todayIso(), status: "present" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadRoster = useCallback(async () => {
    setRosterError(null);
    try {
      const d = await fetchJson<{ roster?: RosterEntry[] }>(
        `/api/labour-roster?projectId=${encodeURIComponent(projectId)}`
      );
      setRoster((d.roster ?? []).filter((r) => r.isActive));
    } catch (err) {
      setRoster([]);
      setRosterError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error && err.message ? err.message : null,
      });
    }
  }, [projectId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const moduleHref = `/labour?projectId=${projectId}&tab=attendance`;

  const fields: CreateField[] = [
    {
      name: "rosterId",
      label: "Worker",
      kind: "select",
      required: true,
      placeholder: rosterError ? "Could not be loaded" : "Select worker",
      options: roster.map((r) => ({ value: r.id, label: r.name })),
    },
    { name: "attendanceDate", label: "Date", kind: "date", required: true },
    {
      name: "status",
      label: "Status",
      kind: "select",
      required: true,
      options: [
        { value: "present", label: "Present" },
        { value: "half_day", label: "Half Day" },
        { value: "absent", label: "Absent" },
      ],
    },
    { name: "hoursWorked", label: "Hours Worked", kind: "number", placeholder: "e.g. 8" },
  ];

  async function createAttendance() {
    setSaving(true);
    setError(null);
    try {
      await fetchJson("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          rosterId: values.rosterId,
          attendanceDate: values.attendanceDate,
          status: values.status,
          hoursWorked: values.hoursWorked ? Number(values.hoursWorked) : undefined,
        }),
      });
      // No object page for an attendance row -- back to the tab it joined.
      router.replace(moduleHref);
    } catch (err) {
      setError(errorMessage(err, "The attendance could not be recorded."));
      setSaving(false);
    }
  }

  return (
    <CreateScreen
      module="Labour"
      moduleHref={moduleHref}
      objectLabel="Attendance"
      title="Mark Attendance"
      fields={fields}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      extraMissing={rosterError ? ["the roster could not be loaded"] : []}
      banner={
        rosterError ? (
          <PaneErrorCard entity="this project's roster" error={rosterError} onRetry={() => void loadRoster()} />
        ) : undefined
      }
      error={error}
      saving={saving}
      onSubmit={createAttendance}
    />
  );
}
