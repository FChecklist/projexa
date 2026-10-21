"use client";

// R-C14 (Upload site instruction form). The create screen for a site instruction, built on the same frame as the permit create
// screen (kit ObjectScreen in create mode, the shared submit hook, one message band). It posts multipart to the existing
// POST /api/site-instructions: the record is created first and the optional PDF or photo is attached to it afterwards, so a failed
// upload leaves a real instruction behind (the route answers 207 and names both halves; this screen says so and still lands on the
// instruction). The form shape is the industry-standard Architect/Site Instruction record, not a format Sumeet supplied.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GuidedSubmitFailure } from "@/components/GuidedError";
import { FaultPanel } from "@/components/FaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { siDateFault, siFileFault, type Fault } from "@/lib/error-guide/g1-faults";
import { ObjectScreen, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setScreenMessage } from "@/lib/screen-message";
import { useSubmit, SUBMIT_TIMEOUT_MS } from "@/lib/use-submit";
import { fetchJson } from "@/lib/fetch-json";
import { findRecentSiteInstruction, lookForCreated, type SiteInstructionRow } from "@/lib/recover-created";
import {
  SI_MAX_FILE_MB,
  missingSiteInstructionFields,
  missingSiteInstructionReason,
  readCreatedSiteInstruction,
  siteInstructionFileError,
} from "@/lib/site-instruction-form";

type CreatedBody = { siteInstruction?: { id?: string; siNumber?: number }; attachmentError?: string; recovered?: boolean; fileExpected?: boolean };

// A save with a file attached is a multi-step write (record, then upload), so it is given longer than a plain JSON POST.
const SUBMIT_WITH_FILE_TIMEOUT_MS = 25_000;

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
  // GUIDED ERRORS (G1): what is typed is kept in a draft (sessionStorage, 2 h), so leaving through a "Fix it now" link, a sign-in that ran out or a
  // reload loses nothing; thrown away after a successful save. The chosen FILE cannot be kept by a browser: the person is told to choose it again.
  const draftKey = `si-new:${projectId}:${boqId ?? ""}`;
  const draft = useDraft(draftKey, { issueDate: new Date().toISOString().slice(0, 10), toContractor: "", description: "", drawingRef: "", costImpact: false });
  const { issueDate, toContractor, description, drawingRef, costImpact } = draft.value;
  const setIssueDate = (v: string) => draft.set({ issueDate: v });
  const setToContractor = (v: string) => draft.set({ toContractor: v });
  const setDescription = (v: string) => draft.set({ description: v });
  const setDrawingRef = (v: string) => draft.set({ drawingRef: v });
  const setCostImpact = (v: boolean) => draft.set({ costImpact: v });
  const [file, setFile] = useState<File | null>(null);
  // the date is judged once the person has left the box (a year is typed digit by digit: 0002, 0020, 0202, 2026)
  const [dateLeft, setDateLeft] = useState(false);

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

  const missing = missingSiteInstructionFields({ issueDate, toContractor, description });
  const fileError = siteInstructionFileError(file ? { name: file.name, size: file.size } : null);
  // A value that is WRONG (not merely missing) is told at once in the guided panel, with the input outlined: a year that cannot be right, a file of
  // the wrong kind, an empty file, one that is too big.
  const liveFaults: Fault[] = [dateLeft ? siDateFault(issueDate) : null, file ? siFileFault(file, "file") : null].filter((f): f is Fault => f !== null);
  const disabledReason = saving ? "Saving…" : fileError ?? missingSiteInstructionReason(missing);
  const saveDisabled = saving || missing.length > 0 || !!fileError || liveFaults.length > 0 || !!siDateFault(issueDate);

  function createInstruction() {
    if (saveDisabled) {
      if (disabledReason) setMessages([{ level: "error", text: disabledReason }]);
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
        {draft.restored && (
          <p className="text-[12.5px] text-px-muted" data-testid="draft-restored">
            We kept what you typed earlier (choose the instruction file again if you had one).{" "}
            <button type="button" className="underline underline-offset-2" onClick={draft.startFresh}>
              Start fresh
            </button>
          </p>
        )}
        <FaultPanel faults={liveFaults} attempt={liveFaults.length} entityType="site-instruction" projectId={projectId} draftKey={draftKey} />
        <GuidedSubmitFailure failure={submit.failure} onRetry={submit.submit} draftKey={draftKey} />
        <div className="space-y-1.5">
          <Label htmlFor="issueDate">Issue date</Label>
          <Input id="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} onBlur={() => setDateLeft(true)} aria-invalid={dateLeft && siDateFault(issueDate) ? true : undefined} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="toContractor">To contractor</Label>
          <Input id="toContractor" autoFocus value={toContractor} onChange={(e) => setToContractor(e.target.value)} placeholder="e.g. Apex MEP Contractors LLC" />
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
          {fileError && <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{fileError}</p>}
        </div>
        {disabledReason && <p role="status" className="pt-1 text-[12.5px] text-ct-muted">{disabledReason}</p>}
      </div>
    </ObjectScreen>
  );
}
