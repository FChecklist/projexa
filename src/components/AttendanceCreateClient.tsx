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
//
// R67 D-80 merge: the Worker field is the archetype's "combobox" -- typing
// filters the roster, a one-person roster is preselected, and the last worker
// marked on this project is offered back. D-80 originally shipped that picker
// as a hand-rolled form on this screen; it now sits inside the shared
// archetype, so this screen keeps D-67's structure AND the one-click picker.
//
// R67 D-53: the screen opens on the day the caller was looking at (the Daily
// Summary's own date), not silently on today.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { PaneErrorCard } from "@/components/PaneState";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";
import { getLastChoice, setLastChoice } from "@/lib/last-choice";
// R67 C-06: a multi-field create route IS the card -- band 2 stays empty
// while this form is open -- so the save reports itself back to the shell
// and the receipt line lands in the same band a composer write's would.
import { useShellChain } from "@/components/shell/shell-chain-context";

type RosterEntry = { id: string; name: string; employeeCode?: string | null; trade?: string | null; isActive: boolean };

/** D-80: this picker's memory is scoped per user, per project, per picker. */
const WORKER_PICKER = "worker";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendanceCreateClient({ projectId, initialDate }: { projectId: string; initialDate?: string }) {
  const router = useRouter();
  const { pushReceipt } = useShellChain();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterError, setRosterError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rememberedWorker, setRememberedWorker] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({
    attendanceDate: initialDate ?? todayIso(),
    status: "present",
  });

  // Read after mount: localStorage is a browser fact, and reading it during
  // render would differ between the server pass and the client's.
  useEffect(() => {
    setRememberedWorker(getLastChoice(WORKER_PICKER, projectId));
  }, [projectId]);

  const loadRoster = useCallback(async () => {
    setRosterError(null);
    setRosterLoading(true);
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
    } finally {
      setRosterLoading(false);
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
      kind: "combobox",
      required: true,
      loading: rosterLoading,
      placeholder: rosterError ? "Could not be loaded" : "Type a name or ID",
      // id + trade as the hint, so typing "mas" or an employee code both find
      // the right person and two workers with the same name stay apart.
      options: roster.map((r) => ({
        value: r.id,
        label: r.name,
        hint: [r.employeeCode, r.trade].filter(Boolean).join(" · ") || undefined,
      })),
      storedValue: rememberedWorker,
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

  const submit = useSubmit({
    objectLabel: "Attendance",
    buildRequest: () => ({
      input: "/api/attendance",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          rosterId: values.rosterId,
          attendanceDate: values.attendanceDate,
          status: values.status,
          hoursWorked: values.hoursWorked ? Number(values.hoursWorked) : undefined,
        }),
      },
    }),
    // No object page for an attendance row -- back to the tab it joined.
    onSuccess: () => {
      // Remembered only after the server accepted it: a choice that failed to
      // save is not the choice to offer back next time.
      setLastChoice(WORKER_PICKER, projectId, values.rosterId);
      // R67 C-06: the save reports itself back to the shell -- the receipt
      // line lands in the same band a composer write's would.
      const worker = roster.find((r) => r.id === values.rosterId);
      pushReceipt({
        text: `Marked ${worker?.name ?? "this worker"} ${values.status.replace("_", " ")} on ${values.attendanceDate}`,
        href: moduleHref,
      });
      router.replace(moduleHref);
    },
  });

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
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
    />
  );
}
