"use client";

// R-C14 (Upload site instruction form). The create screen for a site instruction, built on the same frame as the permit create
// screen (kit ObjectScreen in create mode, the shared submit hook, one message band). It posts multipart to the existing
// POST /api/site-instructions: the record is created first and the optional PDF or photo is attached to it afterwards, so a failed
// upload leaves a real instruction behind (the route answers 207 and names both halves; this screen says so and still lands on the
// instruction). The form shape is the industry-standard Architect/Site Instruction record, not a format Sumeet supplied.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GuidedSubmitFailure } from "@/components/GuidedError";
import { ObjectScreen, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setScreenMessage } from "@/lib/screen-message";
// GUIDED ERRORS (G2): what was typed survives leaving the form, a wrong or missing entry is written beside its box AND explained in the guide panel
// (nothing is sent while a fault exists), and a refusal from the server is the same panel with the server's own words.
import FaultPanel from "@/components/FaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { messageFor, siteInstructionFaults, siteInstructionFileFault, type Fault } from "@/lib/error-guide/g2-faults";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import { useSubmit, SUBMIT_TIMEOUT_MS } from "@/lib/use-submit";
import { fetchJson } from "@/lib/fetch-json";
import { findRecentSiteInstruction, lookForCreated, type SiteInstructionRow } from "@/lib/recover-created";
import { SI_MAX_FILE_MB, readCreatedSiteInstruction } from "@/lib/site-instruction-form";

type CreatedBody = { siteInstruction?: { id?: string; siNumber?: number }; attachmentError?: string; recovered?: boolean; fileExpected?: boolean };

// A save with a file attached is a multi-step write (record, then upload), so it is given longer than a plain JSON POST.
const SUBMIT_WITH_FILE_TIMEOUT_MS = 25_000;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function SiteInstructionCreateClient({
  projectId,
  projectName,
  boqId,
  boqTitle,
}: {
  projectId: string;
  projectName?: string;
  /** Set when the screen is opened from a BOQ: the instruction is linked to it. */
  boqId?: string;
  boqTitle?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const draftKey = `site-instruction-new:${projectId}`;
  const draft = useDraft(draftKey, { issueDate: todayLocal(), toContractor: "", description: "", drawingRef: "", costImpact: false });
  const { issueDate, toContractor, description, drawingRef, costImpact } = draft.value;
  const setIssueDate = (v: string) => draft.set({ issueDate: v });
  const setToContractor = (v: string) => draft.set({ toContractor: v });
  const setDescription = (v: string) => draft.set({ description: v });
  const setDrawingRef = (v: string) => draft.set({ drawingRef: v });
  const setCostImpact = (v: boolean) => draft.set({ costImpact: v });
  const [file, setFile] = useState<File | null>(null);
  const [attempted, setAttempted] = useState(false);

  // What the last request actually carried, so the lookup after a timeout matches THAT save even if a field was edited since.
  const sent = useRef<{ issueDate: string; toContractor: string; description: string; hasFile: boolean } | null>(null);

  const submit = useSubmit<CreatedBody>({
    objectLabel: "Site instruction",
    timeoutMs: file ? SUBMIT_WITH_FILE_TIMEOUT_MS : SUBMIT_TIMEOUT_MS,
    // Sumeet audit 2026-10-20: on a cold server the save outlived the wait although the record and file were stored. Look for it
    // before telling the user it "may have been saved", and land on it when it is there.
    recoverAfterTimeout: () =>
      lookForCreated(async () => {
        const s = sent.current;
        if (!s) return null;
        const data = await fetchJson<{ siteInstructions?: SiteInstructionRow[] }>(`/api/site-instructions?projectId=${encodeURIComponent(projectId)}`);
        const hit = findRecentSiteInstruction(data?.siteInstructions, s);
        return hit ? { siteInstruction: { id: hit.id, siNumber: hit.siNumber ?? undefined }, recovered: true, fileExpected: s.hasFile } : null;
      }),
    buildRequest: () => {
      sent.current = { issueDate, toContractor: toContractor.trim(), description: description.trim(), hasFile: !!file };
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("issueDate", issueDate);
      formData.set("toContractor", toContractor.trim());
      formData.set("description", description.trim());
      if (drawingRef.trim()) formData.set("drawingRef", drawingRef.trim());
      formData.set("costImpact", costImpact ? "true" : "false");
      if (boqId) formData.set("boqId", boqId);
      if (file) formData.set("file", file);
      return { input: "/api/site-instructions", init: { method: "POST", body: formData } };
    },
    onSuccess: (data) => {
      const receipt = readCreatedSiteInstruction(data);
      draft.clear();
      setScreenMessage("site-instructions.object", { level: receipt.level, text: receipt.text });
      router.push(`/site-instructions/${receipt.id}?projectId=${encodeURIComponent(projectId)}`);
    },
  });
  const saving = submit.saving;

  const fileFault = siteInstructionFileFault(file ? { name: file.name, size: file.size } : null, "file");
  const faults: Fault[] = [...siteInstructionFaults({ issueDate, toContractor, description }), ...(fileFault ? [fileFault] : [])];
  // a missing entry is only shown after the first press of Save; a wrong file or a future date is shown at once
  const shown = faults.filter((f) => attempted || !/_MISSING$/.test(f.code));
  const saveDisabled = saving;

  function createInstruction() {
    setAttempted(true);
    if (faults.length > 0) {
      setMessages([]);
      const el = findFocusTarget(faults[0].field);
      if (el) highlightElement(el);
      return;
    }
    setMessages([]);
    submit.submit();
  }

  const bandMessages: FieldMessage[] = messages; // the hook's failure is shown by <GuidedSubmitFailure> below
  const backToList = () => router.push(`/site-instructions?projectId=${encodeURIComponent(projectId)}`);

  return (
    <ObjectScreen
      breadcrumb="Site Instructions / New Site Instruction"
      title="New Site Instruction"
      subtitle={[projectName ? `For project: ${projectName}` : null, boqTitle ? `Linked to BOQ: ${boqTitle}` : null].filter(Boolean).join(" · ") || undefined}
      mode="create"
      hasDraft={false}
      onSave={createInstruction}
      onCancel={backToList}
      onBack={backToList}
      saveDisabled={saveDisabled}
      messages={bandMessages}
    >
      <div className="space-y-3 px-4 py-3">
        {draft.restored && !submit.failure && (
          <p role="status" data-testid="si-draft-restored" className="rounded-md border border-px-info-border bg-px-info-light px-3 py-2 text-[12.5px] text-px-info">
            We put back what you had typed here before you left. Check it, then press Save.
          </p>
        )}
        <FaultPanel faults={shown} draftKey={draftKey} />
        <GuidedSubmitFailure failure={submit.failure} onRetry={submit.submit} draftKey={draftKey} />
        <div className="space-y-1.5">
          <Label htmlFor="issueDate">Issue date</Label>
          <Input id="issueDate" data-testid="issueDate" type="date" max={todayLocal()} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          {messageFor(shown, "issueDate") && <p role="alert" className="text-[12.5px] text-px-error">{messageFor(shown, "issueDate")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="toContractor">To contractor</Label>
          <Input id="toContractor" autoFocus value={toContractor} onChange={(e) => setToContractor(e.target.value)} placeholder="e.g. Apex MEP Contractors LLC" />
          {messageFor(shown, "toContractor") && <p role="alert" className="text-[12.5px] text-px-error">{messageFor(shown, "toContractor")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Instruction</Label>
          <textarea
            id="description"
            rows={4}
            className="w-full rounded-md border border-ct-border bg-white px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the contractor is instructed to do"
          />
          {messageFor(shown, "description") && <p role="alert" className="text-[12.5px] text-px-error">{messageFor(shown, "description")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="drawingRef">Drawing reference (optional)</Label>
          <Input id="drawingRef" value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} placeholder="e.g. A-203 rev C" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={costImpact} onChange={(e) => setCostImpact(e.currentTarget.checked)} />
          This instruction changes the cost
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="file">Instruction file (optional)</Label>
          <Input
            id="file"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files && e.target.files.length > 0 ? e.target.files[0] : null)}
          />
          <p className="text-[12.5px] text-ct-muted">PDF or photo, up to {SI_MAX_FILE_MB} MB</p>
          {fileFault && <p role="alert" className="text-[12.5px] text-px-error">{fileFault.message}</p>}
        </div>
      </div>
    </ObjectScreen>
  );
}
