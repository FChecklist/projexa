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

type IssueType = { id: string; name: string; isDefault?: boolean | null };
const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

export default function ScheduleTaskCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [types, setTypes] = useState<IssueType[]>([]);
  const [typesState, setTypesState] = useState<ScheduleTypesState>("loading");
  const [values, setValues] = useState<Record<string, string>>({ priority: "no_priority" });

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
    { name: "dueDate", label: "Due Date", kind: "date" },
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
          dueDate: values.dueDate || undefined,
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
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
    />
  );
}
