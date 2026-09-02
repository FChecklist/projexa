"use client";

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
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import { PaneErrorCard } from "@/components/PaneState";
import type { CreateField } from "@/lib/create-screen";

type IssueType = { id: string; name: string; isDefault?: boolean | null };
const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

export default function ScheduleTaskCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [types, setTypes] = useState<IssueType[]>([]);
  const [typesError, setTypesError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ priority: "no_priority" });

  const loadTypes = useCallback(async () => {
    setTypesError(null);
    try {
      const data = await fetchJson<{ types?: IssueType[] }>("/api/schedule/types");
      const loaded = data.types ?? [];
      setTypes(loaded);
      const defaultType = loaded.find((t) => t.isDefault) ?? loaded[0];
      if (defaultType) setValues((v) => ({ ...v, typeId: v.typeId ?? defaultType.id }));
    } catch (err) {
      setTypes([]);
      setTypesError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error && err.message ? err.message : null,
      });
    }
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  const moduleHref = `/schedule?projectId=${projectId}`;

  const fields: CreateField[] = [
    { name: "title", label: "Title", kind: "text", required: true, placeholder: "e.g. Pour foundation slab", wide: true },
    {
      name: "typeId",
      label: "Type",
      kind: "select",
      placeholder: typesError ? "Could not be loaded — the project's default will be used" : "Select a type",
      options: types.map((t) => ({ value: t.id, label: t.name })),
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
      // Type is optional and the server has its own default, so a failed
      // read is reported without blocking the save.
      banner={
        typesError ? (
          <PaneErrorCard entity="the task-type list" error={typesError} onRetry={() => void loadTypes()} />
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
