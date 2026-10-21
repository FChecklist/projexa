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
import { GuidedError } from "@/components/GuidedError";
import { DraftRestoredNote } from "@/components/DraftRestoredNote";
import { contextFromFailure } from "@/lib/error-guide/context";
import { fault, notANumber, todayLocalIso, useCheckedSubmit, useFormDraft } from "@/lib/guided-form";
// R80 GAP-8: WHO is looking at this form. Passive -- it reads the shell
// bootstrap M24Shell has already fetched for this route and never asks for it
// itself, so identity costs this create screen no round trip (F-19's rule).
import { useShellUserId } from "@/lib/shell-store";
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
  const userId = useShellUserId();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterError, setRosterError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rememberedWorker, setRememberedWorker] = useState<string | null>(null);
  // G3 guided errors: every typed value survives a "Fix it now" detour and comes back with the person; cleared after a successful save.
  const draft = useFormDraft(`attendance-new:${projectId}`, { attendanceDate: initialDate ?? todayIso(), status: "present" });
  const values = draft.values;

  // Read after mount: localStorage is a browser fact, and reading it during
  // render would differ between the server pass and the client's.
  //
  // R80 GAP-8: re-runs when the identity lands, because the memory is keyed to
  // the person. Until it does, `userId` is null and the read lands in the
  // not-yet-known bucket, which is permanently empty -- the v2 prefix orphaned
  // v1's entries and setLastChoice() refuses to write there at all. So the
  // worst case is a suggestion that appears late, never one belonging to the
  // previous person on this browser.
  //
  // It is NOT one frame late: M24Shell defers the shell bootstrap to an idle
  // callback on /new routes, so this can be a second or more behind the roster
  // read below. EntityCombobox re-runs its preselection when this lands, which
  // is what makes the suggestion survive that gap.
  useEffect(() => {
    setRememberedWorker(getLastChoice(WORKER_PICKER, projectId, userId));
  }, [projectId, userId]);

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
      // save is not the choice to offer back next time. And only when `userId`
      // is known -- a save made before the bootstrap lands (or after it failed)
      // is simply not remembered, rather than being filed under a scope the
      // next person on this browser would read back.
      setLastChoice(WORKER_PICKER, projectId, values.rosterId, userId);
      // R67 C-06: the save reports itself back to the shell -- the receipt
      // line lands in the same band a composer write's would.
      const worker = roster.find((r) => r.id === values.rosterId);
      pushReceipt({
        text: `Marked ${worker?.name ?? "this worker"} ${values.status.replace("_", " ")} on ${values.attendanceDate}`,
        href: moduleHref,
      });
      draft.clear();
      router.replace(moduleHref);
    },
  });

  const checked = useCheckedSubmit(submit, () => {
    const date = values.attendanceDate ?? "";
    if (date > todayLocalIso()) {
      return fault("DATE_FUTURE", "attendanceDate", `The date ${date} is in the future. Attendance can only be marked for today or an earlier day.`);
    }
    const hours = (values.hoursWorked ?? "").trim();
    if (hours !== "" && (notANumber(hours) || Number(hours) < 0 || Number(hours) > 24)) {
      return fault("HOURS_RANGE", "hoursWorked", `The hours "${hours}" are not possible. Hours worked must be a number from 0 to 24, for example 8.`);
    }
    return null;
  });
  // The roster has nobody on it yet: attendance is marked for workers on the roster, so say so and take the person to add or import them.
  const noWorkers = !rosterLoading && !rosterError && roster.length === 0;

  return (
    <CreateScreen
      module="Labour"
      moduleHref={moduleHref}
      objectLabel="Attendance"
      title="Mark Attendance"
      fields={fields}
      values={values}
      onChange={(name, value) => {
        checked.clearFault();
        draft.onChange(name, value);
      }}
      extraMissing={rosterError ? ["the roster could not be loaded"] : []}
      banner={
        <>
          <DraftRestoredNote draft={draft} />
          {rosterError ? <PaneErrorCard entity="this project's roster" error={rosterError} onRetry={() => void loadRoster()} /> : null}
          {noWorkers ? <GuidedError ctx={contextFromFailure(fault("NO_WORKERS", "rosterId", "There is nobody on this project's roster yet."), { projectId })} draftKey={`attendance-new:${projectId}`} /> : null}
        </>
      }
      failure={checked.failure}
      onRetry={checked.onRetry}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={checked.onSubmit}
    />
  );
}
