"use client";

// LOCAL-FIRST shell, Site Instructions (R-C14): the project's formal instructions to contractors read from the laptop's own copy, and a new
// one kept on the laptop at once (create_site_instruction through the outbox). The SI number is the server's, so a new row says "Waiting to
// sync" with no number until it has been sent. After a save the screen lands on the list, where the new row shows "Waiting to sync" (the online
// form lands on the created item; an unsent one has no server id yet, so its row in the list is the item). A PDF or photo for the instruction, and
// the BOQ it varies, are added online: the registry's create_site_instruction takes no file address (unlike create_permit / create_drawing /
// create_document, whose externalUrl is what the file queue feeds), and the file is linked to the instruction's server id, which does not exist
// until the server has the instruction. So the form says so, and the sent instruction's page (a link on its number) has an "Add file" action.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
// GUIDED ERRORS (G1): an empty or wrong value is named in the guided panel (what happened, why, what to do, the box outlined) instead of the browser's
// own pop-up bubble, and what was typed is kept in a draft (the same key and shape as the online New Site Instruction screen).
import { FaultPanel } from "@/components/FaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { siDateFault, type Fault } from "@/lib/error-guide/g1-faults";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, ReadOnlyNote, SaveNote, Screen, StateMessage, Waiting, fieldClass, mayWrite, projectName, textHandlers, withProject } from "./DeliveryParts";
import { dateText } from "./DocumentsShared";
import { localDay } from "./delivery-local";
import { BACK_LINK, NeedsConnection, useSiteSave } from "./SiteParts";
import { createSiteInstructionOffline } from "./site-writes";
import type { ListData, LocalSiteInstruction } from "./site-records";

const heading = (shell: ShellScreenProps["shell"], projectId: string | null, base: string) => {
  const name = projectName(shell, projectId ?? shell.projectId);
  return `${base}${name ? ` / ${name}` : ""}`;
};

export function SiteInstructionListScreen({ shell, data }: ShellScreenProps<ListData<LocalSiteInstruction>>) {
  if (data.state !== "local") return <StateMessage testId="si-list" title="Site Instructions" state={data.state} what="instruction" />;
  return (
    <Screen testId="si-list" state="local" title={heading(shell, data.projectId, "Site Instructions")}>
      <CopyNote testId="si-list-copy-note" syncedAt={data.syncedAt} />
      {mayWrite(shell) ? <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/site-instructions/new", data.projectId)}>New instruction</a></p> : null}
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No site instructions in this project yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>To</TableHead><TableHead>Instruction</TableHead><TableHead>Drawing</TableHead><TableHead>Changes</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((si) => (
                <TableRow key={si.id} data-testid="si-row" data-si-id={si.id}>
                  <TableCell>
                    {si.siNumber === null ? DASH : si.waiting ? `SI-${si.siNumber}` : <a className={BACK_LINK} data-testid="si-open" href={withProject(`/site-instructions/${si.id}`, data.projectId)}>{`SI-${si.siNumber}`}</a>}
                    <Waiting on={si.waiting} />
                  </TableCell>
                  <TableCell>{dateText(si.issueDate)}</TableCell>
                  <TableCell>{si.toContractor ?? DASH}</TableCell>
                  <TableCell className="max-w-xs truncate">{si.description}</TableCell>
                  <TableCell>{si.drawingRef ?? DASH}</TableCell>
                  <TableCell>{[si.costImpact ? "Cost" : null, si.timeImpact ? "Time" : null].filter(Boolean).join(", ") || DASH}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Screen>
  );
}

export function SiteInstructionNewScreen({ shell, data }: ShellScreenProps<ListData<LocalSiteInstruction>>) {
  const draftKey = `si-new:${data.state === "local" ? data.projectId : "none"}:`;
  const draft = useDraft(draftKey, { issueDate: localDay(), toContractor: "", description: "", drawingRef: "", costImpact: false, timeImpact: false });
  const { issueDate, toContractor, description, drawingRef, costImpact, timeImpact } = draft.value;
  const setIssueDate = (v: string) => draft.set({ issueDate: v });
  const setToContractor = (v: string) => draft.set({ toContractor: v });
  const setDescription = (v: string) => draft.set({ description: v });
  const setDrawingRef = (v: string) => draft.set({ drawingRef: v });
  const setCostImpact = (v: boolean) => draft.set({ costImpact: v });
  const setTimeImpact = (v: boolean) => draft.set({ timeImpact: v });
  const [faults, setFaults] = useState<Fault[]>([]);
  const [attempt, setAttempt] = useState(0);
  const { saving, note, save } = useSiteSave(shell);

  const siFaults = (): Fault[] => {
    const found: Fault[] = [];
    const dateFault = issueDate ? siDateFault(issueDate) : { code: "SI_DATE_INVALID", field: "issueDate", message: "The issue date is empty. Pick the day the instruction was issued. Nothing was saved." };
    if (dateFault) found.push(dateFault);
    if (!toContractor.trim()) found.push({ code: "SI_FIELD_REQUIRED", field: "toContractor", message: "Who is the instruction for? Type the contractor's name, for example Apex MEP Contractors LLC. Nothing was saved." });
    if (!description.trim()) found.push({ code: "SI_FIELD_REQUIRED", field: "description", message: "The instruction itself is empty. Type what the contractor is instructed to do. Nothing was saved." });
    return found;
  };
  // a fixed fault leaves the panel as soon as it is fixed
  useEffect(() => {
    if (faults.length === 0) return;
    setFaults((prev) => prev.filter((p) => siFaults().some((c) => c.code === p.code && c.field === p.field)));
  }, [issueDate, toContractor, description]);

  if (data.state !== "local") return <StateMessage testId="si-new" title="New site instruction" state={data.state} what="project" />;
  const projectId = data.projectId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = siFaults();
    setFaults(found);
    if (found.length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    const ok = await save(() => createSiteInstructionOffline(shell.data, { projectId, issueDate, toContractor, description, drawingRef, costImpact, timeImpact }));
    if (ok) {
      draft.clear();
      shell.navigate(withProject("/site-instructions", projectId)); // the list, where the new row says "Waiting to sync"
    }
  }

  return (
    <Screen testId="si-new" state="local" title={heading(shell, projectId, "New site instruction")}>
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="si-form" onSubmit={submit} noValidate>
          {draft.restored ? (
            <p className="mb-3 text-[12.5px] text-px-muted" data-testid="draft-restored">
              We kept what you typed earlier.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => { draft.startFresh(); setFaults([]); }}>Start fresh</button>
            </p>
          ) : null}
          <FaultPanel faults={faults} attempt={attempt} entityType="site-instruction" projectId={projectId} draftKey={draftKey} className="mb-3" />
          <label className="block text-sm">Issue date<input aria-label="Issue date" id="issueDate" aria-invalid={faults.some((f) => f.field === "issueDate") ? true : undefined} type="date" className={fieldClass} value={issueDate} {...textHandlers(setIssueDate)} required /></label>
          <label className="mt-3 block text-sm">To contractor<input aria-label="To contractor" id="toContractor" aria-invalid={faults.some((f) => f.field === "toContractor") ? true : undefined} className={fieldClass} value={toContractor} {...textHandlers(setToContractor)} required /></label>
          <label className="mt-3 block text-sm">Instruction<textarea aria-label="Instruction" id="description" aria-invalid={faults.some((f) => f.field === "description") ? true : undefined} rows={3} className={fieldClass} value={description} {...textHandlers(setDescription)} required /></label>
          <label className="mt-3 block text-sm">Drawing reference<input aria-label="Drawing reference" className={fieldClass} value={drawingRef} {...textHandlers(setDrawingRef)} /></label>
          <label className="mt-3 flex items-center gap-2 text-sm"><input aria-label="Changes the cost" type="checkbox" checked={costImpact} onChange={(e) => setCostImpact(e.currentTarget.checked)} />Changes the cost</label>
          <label className="mt-2 flex items-center gap-2 text-sm"><input aria-label="Changes the time" type="checkbox" checked={timeImpact} onChange={(e) => setTimeImpact(e.currentTarget.checked)} />Changes the time</label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save instruction"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <NeedsConnection>A PDF or photo cannot be attached while writing the instruction here. Save it, and once it has been sent (it then has its SI number) open it from the list and choose Add file. The BOQ it varies is also set online. The number is given by the server.</NeedsConnection>
      <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/site-instructions", projectId)}>Back to the site instructions</a></p>
    </Screen>
  );
}
