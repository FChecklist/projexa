"use client";

// R67 MERGE (lane D0 x lane F2). Lane F2's item F-19 (audit R-245) asked that
// a create form's lookup say which of its three states it is in, and that a
// FAILED lookup never look like "this org has none". Lane D0 rebuilt this
// screen onto the shared CreateScreen + useSubmit archetype (D-72 / D-67) and
// implements exactly that rule -- the lookup's failure reaches the form as a
// banner with Retry and as the primary's own disabled reason, and the empty
// placeholder is reachable only from a successful read. Under decision D-11
// the version on main is canonical, and F2's separate useLookup()/
// LookupFieldError pair is not folded in beside it: that would leave two
// mechanisms for one rule on one screen. F2's helpers stay in the repo for the
// create forms that still use them.

// Real-screen conversion (2026-08-30) -- replaces ScheduleBoardClient.tsx's
// old "New Task" Dialog popup with a real create screen, same fields.
//
// R67 D-67: onto the shared archetype, and off the last unguarded
// `.then((res) => res.json())` read in the construction modules (see
// src/lib/no-swallowed-http-errors.test.ts's third guard). The type list is
// a genuine convenience -- the server applies its own default when none is
// sent -- so its failure does not block the save; it is simply no longer
// silent, and the select says why it is empty instead of sitting on
// "Loading…" forever.
//
// R67 G-04 (R-231) states the same rule more precisely and is kept whole:
// the four states of the Type control, their one instruction each, and the
// rule that "Loading…" is never a VALUE live in
// src/lib/schedule-type-state.ts, where they are unit-tested, and are
// rendered by the archetype's own select. Two situations that used to
// collapse into one empty list -- "this org has no task types" and "the call
// failed" -- now read differently, which is what
// e2e/schedule-task-type-signage.spec.ts asserts in a browser.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { fetchJson } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import {
  SCHEDULE_TYPE_HINT,
  SCHEDULE_TYPE_PLACEHOLDER,
  scheduleTypeDisabled,
  scheduleTypesState,
  type ScheduleTypesState,
} from "@/lib/schedule-type-state";
import type { CreateField } from "@/lib/create-screen";
import { dueDateError, dueDateFromDuration, durationFieldValue } from "@/lib/schedule-activity";

type IssueType = { id: string; name: string; isDefault?: boolean | null };
type ScheduleTask = { id: string; number?: number; title: string };
type BoqLine = { id: string; description?: string | null; itemCode?: string | null };
type Boq = { lineItems?: BoqLine[] };
const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

type Lookup<T> = { rows: T[]; loading: boolean; error: string | null };
function emptyLookup<T>(): Lookup<T> {
  return { rows: [], loading: true, error: null };
}

export default function ScheduleTaskCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [types, setTypes] = useState<IssueType[]>([]);
  const [typesState, setTypesState] = useState<ScheduleTypesState>("loading");
  const [values, setValues] = useState<Record<string, string>>({ priority: "no_priority" });
  // R67 D-47: the four things the form could not send at all -- a START, a
  // DURATION, what the activity FOLLOWS, and which BOQ line it earns its value
  // against -- which is why the Timeline it feeds could not draw a bar, could
  // not draw a dependency line, and had nothing to compare against a baseline.
  const [predecessors, setPredecessors] = useState<Lookup<ScheduleTask>>(emptyLookup<ScheduleTask>());
  const [boqLines, setBoqLines] = useState<Lookup<BoqLine>>(emptyLookup<BoqLine>());

  const loadPredecessors = useCallback(async () => {
    setPredecessors((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchJson<{ tasks?: ScheduleTask[] }>(
        `/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`
      );
      setPredecessors({ rows: data.tasks ?? [], loading: false, error: null });
    } catch (err) {
      setPredecessors({
        rows: [],
        loading: false,
        error: err instanceof Error && err.message ? err.message : "Could not load this project's activities",
      });
    }
  }, [projectId]);

  const loadBoqLines = useCallback(async () => {
    setBoqLines((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      setBoqLines({ rows: (data.boqs ?? []).flatMap((b) => b.lineItems ?? []), loading: false, error: null });
    } catch (err) {
      setBoqLines({
        rows: [],
        loading: false,
        error: err instanceof Error && err.message ? err.message : "Could not load this project's BOQ lines",
      });
    }
  }, [projectId]);

  useEffect(() => {
    void loadPredecessors();
    void loadBoqLines();
  }, [loadPredecessors, loadBoqLines]);

  const isMilestone = values.isMilestone === "true";

  /**
   * R67 D-47/D-56. Start, Duration and Finish are three views of ONE window,
   * so editing any of them re-derives the others rather than letting the form
   * hold three facts that disagree. Ticking Milestone collapses the window
   * onto the start date (a milestone IS a zero-length activity) and unticking
   * hands the finish date back.
   */
  const handleChange = useCallback((name: string, value: string) => {
    setValues((v) => {
      const next = { ...v, [name]: value };
      if (name === "isMilestone") {
        if (value === "true") next.dueDate = next.startDate ?? "";
        return next;
      }
      if (v.isMilestone === "true") {
        // A milestone has no duration to preserve: its finish IS its start.
        if (name === "startDate") next.dueDate = value;
        return next;
      }
      if (name === "durationDays") {
        const derived = dueDateFromDuration(next.startDate ?? "", value);
        if (derived) next.dueDate = derived;
      } else if (name === "dueDate") {
        next.durationDays = durationFieldValue(next.startDate ?? "", value);
      } else if (name === "startDate") {
        if (next.dueDate) next.durationDays = durationFieldValue(value, next.dueDate);
        else if (next.durationDays) {
          const derived = dueDateFromDuration(value, next.durationDays);
          if (derived) next.dueDate = derived;
        }
      }
      return next;
    });
  }, []);

  const loadTypes = useCallback(async () => {
    setTypesState("loading");
    try {
      // fetchJson throws on a non-2xx. The old `.then((res) => res.json())`
      // let a 502 fall through to `data.types ?? []`, so an upstream failure
      // was displayed as "this org has no task types" -- different facts.
      const data = await fetchJson<{ types?: IssueType[] }>("/api/schedule/types");
      const loaded = data.types ?? [];
      setTypes(loaded);
      const defaultType = loaded.find((t) => t.isDefault) ?? loaded[0];
      if (defaultType) setValues((v) => ({ ...v, typeId: v.typeId ?? defaultType.id }));
      setTypesState(scheduleTypesState({ loaded, failed: false }));
    } catch {
      setTypes([]);
      setTypesState(scheduleTypesState({ loaded: null, failed: true }));
    }
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  const moduleHref = `/schedule?projectId=${projectId}`;

  const typeHint = SCHEDULE_TYPE_HINT[typesState];
  const fields: CreateField[] = [
    { name: "title", label: "Title", kind: "text", required: true, placeholder: "e.g. Pour foundation slab", wide: true },
    {
      name: "typeId",
      label: "Type",
      kind: "select",
      testId: "schedule-task-type",
      loading: typesState === "loading",
      disabled: scheduleTypeDisabled(typesState),
      placeholder: SCHEDULE_TYPE_PLACEHOLDER[typesState],
      options: types.map((t) => ({ value: t.id, label: t.name })),
      // The one instruction for this state, plus -- when the call FAILED
      // rather than came back empty -- a way to ask again without losing the
      // title already typed.
      help: typeHint ? (
        <>
          {typeHint}
          {typesState === "error" && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void loadTypes()}
                className="font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </>
          )}
        </>
      ) : undefined,
    },
    {
      name: "priority",
      label: "Priority",
      kind: "select",
      required: true,
      options: PRIORITY_OPTIONS.map((p) => ({ value: p, label: p.replace(/_/g, " ") })),
    },
    {
      // R67 D-47: a programme needs a START. Required, and it is what the
      // duration and the finish are both derived from.
      name: "startDate",
      label: "Start Date",
      kind: "date",
      required: true,
    },
    {
      name: "durationDays",
      label: "Duration (days)",
      kind: "number",
      placeholder: "e.g. 5",
      disabled: isMilestone,
      help: isMilestone ? "A milestone has no duration" : "Or set the finish date - each derives the other",
    },
    {
      name: "dueDate",
      label: "Due Date",
      kind: "date",
      disabled: isMilestone,
      help: isMilestone ? "Follows the start date" : undefined,
      validate: (value) => dueDateError(values.startDate ?? "", value),
    },
    {
      // R67 D-56: a milestone is an activity with a zero-length window
      // (Finish = Start) rather than a flag column -- pms_issues already
      // carries both dates, and "no duration" IS what a milestone means.
      name: "isMilestone",
      label: "Milestone",
      kind: "checkbox",
      placeholder: "Milestone (finish is the same day as start)",
    },
    {
      name: "predecessorId",
      label: "Predecessor",
      kind: "select",
      loading: predecessors.loading,
      placeholder: predecessors.error ? "Predecessors didn't load" : "None",
      options: predecessors.rows.map((t) => ({
        value: t.id,
        label: t.number ? `#${t.number} ${t.title}` : t.title,
      })),
      help: predecessors.error ? (
        <>
          {predecessors.error}{" "}
          <button
            type="button"
            onClick={() => void loadPredecessors()}
            className="font-medium underline underline-offset-2"
          >
            Retry
          </button>
        </>
      ) : predecessors.loading ? (
        "The activity this one follows"
      ) : predecessors.rows.length === 0 ? (
        // D-47: an empty dropdown says nothing. This one says why it is empty.
        "No other activities on this project yet - this will be the first"
      ) : (
        "The activity this one follows"
      ),
    },
    {
      name: "boqLineItemId",
      label: "BOQ item",
      kind: "select",
      loading: boqLines.loading,
      placeholder: boqLines.error ? "BOQ lines didn't load" : "None",
      options: boqLines.rows.map((l) => ({
        value: l.id,
        label: [l.itemCode, l.description].filter(Boolean).join(" - ") || l.id,
      })),
      help: boqLines.error ? (
        <>
          {boqLines.error}{" "}
          <button
            type="button"
            onClick={() => void loadBoqLines()}
            className="font-medium underline underline-offset-2"
          >
            Retry
          </button>
        </>
      ) : boqLines.loading ? (
        "The scope line this activity earns its value against"
      ) : boqLines.rows.length === 0 ? (
        "No BOQ lines on this project yet - add a BOQ to earn value against it"
      ) : (
        "The scope line this activity earns its value against"
      ),
    },
  ];

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Task",
    buildRequest: () => ({
      input: "/api/schedule/tasks",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: (values.title ?? "").trim(),
          typeId: values.typeId || undefined,
          priority: values.priority,
          startDate: values.startDate,
          dueDate: values.dueDate || undefined,
          // Only one of the two is sent: the finish date is authoritative
          // when the user set it, and the duration is what the service
          // derives it from when they did not.
          durationDays: values.dueDate ? undefined : values.durationDays ? Number(values.durationDays) : undefined,
          predecessorId: values.predecessorId || undefined,
          boqLineItemId: values.boqLineItemId || undefined,
        }),
      },
    }),
    onSuccess: (data) => {
      const id = typeof data?.id === "string" ? data.id : "";
      if (!id) throw new Error("The server did not confirm a saved task");
      router.replace(createdHref("/schedule/tasks", id, values.title));
    },
  });

  return (
    <CreateScreen
      module="Schedule"
      moduleHref={moduleHref}
      objectLabel="Task"
      title="New Task"
      fields={fields}
      values={values}
      onChange={handleChange}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
    />
  );
}
