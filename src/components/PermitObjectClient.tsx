"use client";

// R42 seq21/22: registry-driven Permit object screen (per screen_spec's own
// PERMITS.OBJECT row) -- display/edit/create in one layout (M31), full M29
// draft lifecycle. No detail route existed for ANY of projexa's 49 modules
// before this (only 3 [id] routes existed app-wide) -- this is the first.
import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
// R67 F-34 (D-09): ObjectScreen comes from the FORK (it gains the `loading`
// variant); FormSection and the screen types are still the kit's.
import { FormSection, type ScreenColumn, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { PERMIT_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Permit = {
  id: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
  endDate: string | null;
  notes: string | null;
  tags: string[];
  projectId: string;
  // F_012: GET /api/permits/{id} has always returned this -- a signed
  // Storage link to the permit PDF -- and the page never rendered it
  // anywhere. It was missing from this type, so nothing could.
  documentUrl?: string | null;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  // R52 / F_011 partial. The recorded diagnosis for this route blamed the kit's
  // ObjectScreen/FormSection click-handler attachment. Reading the kit source,
  // that does not hold: Edit and Back are plain React onClick handlers
  // (veridian-ui-kit/src/screens/ObjectScreen.tsx:107-108 and :136-137), and
  // this file wires real functions into both. Whether the three controls are
  // live still needs an authenticated click to settle.
  //
  // What IS wrong here and is fixed below: res.ok was never read. GET
  // /api/permits/[id] answers a failure with { error: "..." }, and that body
  // was stored as the permit. It is truthy, so the `!permit` guard passed it
  // through and the page rendered a permit-shaped screen out of an error --
  // titled "New Permit" (permit.name undefined), with Back pointing at
  // /permits?projectId=undefined. Same defect as A4S14_04/A4S14_05.
  async function load() {
    let permitRes: Permit;
    try {
      permitRes = await fetchJson<Permit>(`/api/permits/${permitId}`);
    } catch (err) {
      setPermit(null);
      setLoadError(errorMessage(err, "Couldn't load this permit"));
      return;
    }
    setLoadError(null);
    setPermit(permitRes);

    // Resume a draft left from a previous session -- proves "draft survives
    // ... AND reload the page" (R42 seq21 oracle): a page reload remounts
    // this component from scratch, and this fetch is the only thing telling
    // it a draft exists server-side.
    // A failed draft lookup must not decide the screen's mode. Treat it as
    // "no draft" -- the permit itself already loaded and is still viewable.
    const draftRes = await fetchJson<{ draft?: { id: string; payload?: Record<string, unknown> } }>(
      `/api/screen-drafts?functionId=permits.object&objectId=${permitId}`
    ).catch(() => ({ draft: undefined }));
    if (draftRes.draft) {
      setDraftId(draftRes.draft.id);
      setHasDraft(true);
      setValues(draftRes.draft.payload ?? {});
      setMode("edit");
    } else {
      setValues(permitRes as unknown as Record<string, unknown>);
    }
  }

  useEffect(() => {
    load();
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

  // "Loading" forever is its own lie. Once the load has failed, say so.
  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <button type="button" onClick={() => load()} className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px]">Retry</button>
      </div>
    );
  }
  // R67 F-34 (R-290): the SAME frame the route's own loading.tsx paints, so the
  // hand-over from the route skeleton to this client is invisible and the word
  // "Loading" is never alone on the screen. It says what it is waiting for after
  // 3 s and offers Retry at 8 s, D-04's abort budget.
  if (!permit) return (
    <ObjectScreen
      loading
      breadcrumb={PERMIT_OBJECT_BREADCRUMB.breadcrumb}
      label={PERMIT_OBJECT_BREADCRUMB.label}
      actions={PERMIT_OBJECT_BREADCRUMB.actions}
    />
  );

  // R42 seq23 live-user finding: Save was clickable with required fields
  // still empty -- a real fail-after-click, against GLOBAL's own idiot-proof
  // rule ("Primary action disabled while mandatory fields are empty, with
  // the count beside it" / "ACTIONS ARE DISABLED BY CONDITION ... NEVER
  // FAIL-AFTER-CLICK"). Computed on every render so the button's disabled
  // state always matches what handleSave would actually reject.
  const missingCount = mode === "edit" ? REQUIRED_COLUMNS.filter((c) => !values[c.field]).length : 0;

  return (
    <>
    {/* R67 A-21: "<project> › Permit Building permit - Villa 21". The name is
        published as it stands: a permit with no name yet publishes an empty
        label, and objectSegmentFor() then leaves the module segment in place
        rather than rendering the bare word "Permit", which would name a screen
        that does not exist. */}
    <ObjectContext moduleId="permits" label={permit.name} projectId={permit.projectId} />
    <ObjectScreen
      breadcrumb={PERMIT_OBJECT_BREADCRUMB.breadcrumb}
      title={permit.name || "New Permit"}
      subtitle={permit.permitNumber ?? undefined}
      mode={mode}
      hasDraft={hasDraft && mode === "display"}
      onEdit={mode === "display" ? handleEdit : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? handleCancel : undefined}
      // R42 seq23 live-user finding: Back dropped ?projectId= entirely,
      // landing on a different (or empty) project's list -- the GLOBAL "Back
      // restores filters/sort/scroll/page" rule can't hold if the list
      // isn't even the same project's list. Preserve it explicitly rather
      // than relying on router.back() (a page reload -- e.g. this seq's own
      // full-reload draft-persistence proof -- has no history entry to go
      // back to).
      onBack={() => router.push(`/permits?projectId=${permit.projectId}`)}
      onAutosave={scheduleAutosave}
      saveDisabled={missingCount > 0}
      saveDisabledReason={missingCount > 0 ? `${missingCount} required field${missingCount === 1 ? "" : "s"}` : undefined}
      messages={messages}
      documentFlow={{ from: [], to: [] }}
    >
      {/* F_012. The permit PDF is the record's core artefact -- the create
          form will not even submit without one (PermitCreateClient.tsx:71,
          `required` on the file input) -- and GET /api/permits/{id} has
          always returned a signed Storage link to it. The detail page
          rendered it nowhere: REQUIRED_COLUMNS and OPTIONAL_COLUMNS list
          only name/permitNumber/permitAuthority/issueDate/endDate/notes.
          You were forced to upload a document you could then never see.

          Deliberately NOT added as an OPTIONAL_COLUMNS field: (a) this is a
          link, not an editable value, and ScreenColumn.control has no LINK
          member -- FILE is for uploading, not for viewing what is already
          there; (b) OPTIONAL_COLUMNS renders inside the "More details"
          section, which is itself broken and unreachable (fault F_011), so
          putting the link there would have closed nothing. It renders here,
          first, in display mode, independent of that section's state.

          The absent case is stated rather than left blank -- same rule as
          everywhere else in this pass: a missing document and a document
          the page failed to surface must not look identical. */}
      {mode === "display" && (
        <section className="mb-4 rounded-md border border-px-border p-3">
          <h3 className="text-[13px] font-semibold text-px-ink">Permit document</h3>
          {permit.documentUrl ? (
            <a
              href={permit.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 text-[13px] underline underline-offset-2"
            >
              <FileText className="size-3.5" aria-hidden />
              View the uploaded permit PDF
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <p className="mt-1 text-[13px] text-ct-muted">
              No document came back with this permit. Every permit is created with a PDF, so if you expected
              one here, it did not load rather than not existing.
            </p>
          )}
        </section>
      )}
      <FormSection
        title="Permit details"
        columns={REQUIRED_COLUMNS}
        values={values}
        mode={mode}
        onFieldChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))}
      />
      <FormSection title="More details" columns={OPTIONAL_COLUMNS} values={values} mode={mode} onFieldChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))} defaultOptionalCollapsed />
    </ObjectScreen>
    </>
  );
}
