"use client";

// R42 seq21/22: registry-driven Permit object screen (per screen_spec's own
// PERMITS.OBJECT row) -- display/edit/create in one layout (M31), full M29
// draft lifecycle. No detail route existed for ANY of projexa's 49 modules
// before this (only 3 [id] routes existed app-wide) -- this is the first.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen, FormSection, type ScreenColumn, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";

type Permit = {
  id: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
  endDate: string | null;
  notes: string | null;
  tags: string[];
};

const REQUIRED_COLUMNS: ScreenColumn[] = [
  { label: "Permit name", field: "name", type: "text", control: "TEXT", required: true, fieldStatus: "REQUIRED" },
  { label: "Permit number", field: "permitNumber", type: "text", control: "TEXT", required: true, fieldStatus: "REQUIRED" },
  { label: "Authority", field: "permitAuthority", type: "text", control: "TEXT", required: true, fieldStatus: "REQUIRED" },
  { label: "Issue date", field: "issueDate", type: "date", control: "DATE", required: true, fieldStatus: "REQUIRED" },
  { label: "Expiry date", field: "endDate", type: "date", control: "DATE", required: true, fieldStatus: "REQUIRED" },
];
const OPTIONAL_COLUMNS: ScreenColumn[] = [{ label: "Notes", field: "notes", type: "text", control: "TEXT", fieldStatus: "OPTIONAL", required: false }];

export default function PermitObjectClient({ permitId }: { permitId: string }) {
  const router = useRouter();
  const [permit, setPermit] = useState<Permit | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  async function load() {
    const permitRes = await fetch(`/api/permits/${permitId}`).then((r) => r.json());
    setPermit(permitRes);

    // Resume a draft left from a previous session -- proves "draft survives
    // ... AND reload the page" (R42 seq21 oracle): a page reload remounts
    // this component from scratch, and this fetch is the only thing telling
    // it a draft exists server-side.
    const draftRes = await fetch(`/api/screen-drafts?functionId=permits.object&objectId=${permitId}`).then((r) => r.json());
    if (draftRes.draft) {
      setDraftId(draftRes.draft.id);
      setHasDraft(true);
      setValues(draftRes.draft.payload ?? {});
      setMode("edit");
    } else {
      setValues(permitRes);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitId]);

  async function handleEdit() {
    const res = await fetch("/api/screen-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ functionId: "permits.object", objectId: permitId, initialPayload: permit }),
    }).then((r) => r.json());
    setDraftId(res.id);
    setHasDraft(true);
    setValues(permit ?? {});
    setMode("edit");
  }

  function scheduleAutosave() {
    if (!draftId) return;
    fetch(`/api/screen-drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: valuesRef.current }),
    }).catch(() => {
      // Autosave failure is non-fatal -- the user's in-memory values are
      // untouched; the next successful autosave (or an explicit Save)
      // catches up. Never surfaced as a blocking error (GLOBAL: autosave is silent).
    });
  }

  async function handleSave() {
    const missing = REQUIRED_COLUMNS.filter((c) => !values[c.field]);
    if (missing.length > 0) {
      setMessages(missing.map((c) => ({ field: c.field, level: "error" as const, text: `${c.label} is required` })));
      return;
    }
    const res = await fetch(`/api/permits/${permitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, draftId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessages([{ level: "error", text: body.error ?? "Failed to save permit" }]);
      return;
    }
    setMessages([]);
    setDraftId(null);
    setHasDraft(false);
    setMode("display");
    await load();
  }

  async function handleCancel() {
    if (draftId) await fetch(`/api/screen-drafts/${draftId}`, { method: "DELETE" });
    setDraftId(null);
    setHasDraft(false);
    setMode("display");
    setValues(permit ?? {});
  }

  if (!permit) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Permits / Permit"
      title={permit.name || "New Permit"}
      subtitle={permit.permitNumber ?? undefined}
      mode={mode}
      hasDraft={hasDraft && mode === "display"}
      onEdit={mode === "display" ? handleEdit : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? handleCancel : undefined}
      onBack={() => router.push("/permits")}
      onAutosave={scheduleAutosave}
      messages={messages}
      documentFlow={{ from: [], to: [] }}
    >
      <FormSection
        title="Permit details"
        columns={REQUIRED_COLUMNS}
        values={values}
        mode={mode}
        onFieldChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))}
      />
      <FormSection title="More details" columns={OPTIONAL_COLUMNS} values={values} mode={mode} onFieldChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))} defaultOptionalCollapsed />
    </ObjectScreen>
  );
}
