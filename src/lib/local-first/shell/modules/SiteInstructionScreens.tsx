"use client";

// LOCAL-FIRST shell, Site Instructions (R-C14): the project's formal instructions to contractors read from the laptop's own copy, and a new
// one kept on the laptop at once (create_site_instruction through the outbox). The SI number is the server's, so a new row says "Waiting to
// sync" with no number until it has been sent. After a save the screen lands on the list, where the new row shows "Waiting to sync" (the online
// form lands on the created item; an unsent one has no server id yet, so its row in the list is the item). A PDF or photo for the instruction, and
// the BOQ it varies, are added online: the registry's create_site_instruction takes no file address (unlike create_permit / create_drawing /
// create_document, whose externalUrl is what the file queue feeds), and the file is linked to the instruction's server id, which does not exist
// until the server has the instruction. So the form says so, and the sent instruction's page (a link on its number) has an "Add file" action.

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [issueDate, setIssueDate] = useState(localDay());
  const [toContractor, setToContractor] = useState("");
  const [description, setDescription] = useState("");
  const [drawingRef, setDrawingRef] = useState("");
  const [costImpact, setCostImpact] = useState(false);
  const [timeImpact, setTimeImpact] = useState(false);
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="si-new" title="New site instruction" state={data.state} what="project" />;
  const projectId = data.projectId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(() => createSiteInstructionOffline(shell.data, { projectId, issueDate, toContractor, description, drawingRef, costImpact, timeImpact }));
    if (ok) {
      setToContractor(""); setDescription(""); setDrawingRef(""); setCostImpact(false); setTimeImpact(false);
      shell.navigate(withProject("/site-instructions", projectId)); // the list, where the new row says "Waiting to sync"
    }
  }

  return (
    <Screen testId="si-new" state="local" title={heading(shell, projectId, "New site instruction")}>
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="si-form" onSubmit={submit}>
          <label className="block text-sm">Issue date<input aria-label="Issue date" type="date" className={fieldClass} value={issueDate} {...textHandlers(setIssueDate)} required /></label>
          <label className="mt-3 block text-sm">To contractor<input aria-label="To contractor" className={fieldClass} value={toContractor} {...textHandlers(setToContractor)} required /></label>
          <label className="mt-3 block text-sm">Instruction<textarea aria-label="Instruction" rows={3} className={fieldClass} value={description} {...textHandlers(setDescription)} required /></label>
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
