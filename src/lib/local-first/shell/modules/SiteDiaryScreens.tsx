"use client";

// LOCAL-FIRST shell, Site Diary: the project's daily entries read from the laptop's own copy (site-records.ts), latest day first, and a
// new entry kept on the laptop at once (create_site_diary through the outbox). This is the screen a site engineer fills in with no signal.
// "Recorded by" is not on the laptop (an id only) and is not shown.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, ReadOnlyNote, SaveNote, Screen, StateMessage, Waiting, fieldClass, mayWrite, projectName, textHandlers, withProject } from "./DeliveryParts";
import { dateText } from "./DocumentsShared";
import { localDay } from "./delivery-local";
import { BACK_LINK, SectionText, useSiteSave } from "./SiteParts";
import { createSiteDiaryOffline } from "./site-writes";
import type { ListData, LocalDiary, ObjectData } from "./site-records";

const heading = (shell: ShellScreenProps["shell"], projectId: string | null, base: string) => {
  const name = projectName(shell, projectId ?? shell.projectId);
  return `${base}${name ? ` / ${name}` : ""}`;
};

export function SiteDiaryListScreen({ shell, data }: ShellScreenProps<ListData<LocalDiary>>) {
  if (data.state !== "local") return <StateMessage testId="diary-list" title="Site Diary" state={data.state} what="entry" />;
  return (
    <Screen testId="diary-list" state="local" title={heading(shell, data.projectId, "Site Diary")}>
      <CopyNote testId="diary-list-copy-note" syncedAt={data.syncedAt} />
      {mayWrite(shell) ? <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/site-diary/new", data.projectId)}>New entry</a></p> : null}
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No site diary entries in this project yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead>Weather</TableHead><TableHead>Work Done</TableHead><TableHead>Labour</TableHead><TableHead>Issues</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((d) => (
                <TableRow key={d.id} data-testid="diary-row" data-diary-id={d.id}>
                  <TableCell><a className="font-medium underline-offset-2 hover:underline" href={withProject(`/site-diary/${encodeURIComponent(d.id)}`, data.projectId)}>{dateText(d.diaryDate)}</a><Waiting on={d.waiting} /></TableCell>
                  <TableCell>{d.weather ?? DASH}</TableCell>
                  <TableCell className="max-w-xs truncate">{d.workDone ?? DASH}</TableCell>
                  <TableCell>{d.labourCount ?? DASH}</TableCell>
                  <TableCell className="max-w-xs truncate text-px-muted">{d.issues ?? DASH}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Screen>
  );
}

export function SiteDiaryObjectScreen({ shell, data }: ShellScreenProps<ObjectData<LocalDiary>>) {
  if (data.state !== "local") return <StateMessage testId="diary-object" title="Site Diary" state={data.state} what="entry" back={{ href: withProject("/site-diary", shell.projectId), label: "Back to the site diary" }} />;
  const d = data.item;
  return (
    <Screen testId="diary-object" state="local" title={dateText(d.diaryDate)}>
      <CopyNote testId="diary-object-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm"><Waiting on={d.waiting} /></p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-px-muted">Weather</dt><dd>{d.weather ?? DASH}</dd>
        <dt className="text-px-muted">Labour Count</dt><dd>{d.labourCount ?? DASH}</dd>
      </dl>
      <SectionText title="Work Done" value={d.workDone} />
      <SectionText title="Visitors" value={d.visitors} />
      <SectionText title="Issues" value={d.issues} />
      <SectionText title="Instructions" value={d.instructions} />
      <SectionText title="Material Received" value={d.materialReceived} />
      <SectionText title="Remarks" value={d.remarks} />
      <p className="mt-4 text-sm"><a className={BACK_LINK} href={withProject("/site-diary", data.projectId)}>Back to the site diary</a></p>
    </Screen>
  );
}

export function SiteDiaryNewScreen({ shell, data }: ShellScreenProps<ListData<LocalDiary>>) {
  const [diaryDate, setDiaryDate] = useState(localDay());
  const [weather, setWeather] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [visitors, setVisitors] = useState("");
  const [labour, setLabour] = useState("");
  const [issues, setIssues] = useState("");
  const [instructions, setInstructions] = useState("");
  const [materialReceived, setMaterialReceived] = useState("");
  const [remarks, setRemarks] = useState("");
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="diary-new" title="New site diary entry" state={data.state} what="project" />;
  const projectId = data.projectId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const labourCount = labour.trim() === "" ? null : Number(labour);
    const ok = await save(() =>
      createSiteDiaryOffline(shell.data, { projectId, diaryDate, weather, workDone, visitors, labourCount, issues, instructions, materialReceived, remarks })
    );
    if (ok) { setWeather(""); setWorkDone(""); setVisitors(""); setLabour(""); setIssues(""); setInstructions(""); setMaterialReceived(""); setRemarks(""); }
  }

  const area = (name: string, value: string, set: (v: string) => void) => (
    <label className="mt-3 block text-sm">{name}<textarea aria-label={name} className={fieldClass} rows={2} value={value} {...textHandlers(set)} /></label>
  );
  return (
    <Screen testId="diary-new" state="local" title={heading(shell, projectId, "New site diary entry")}>
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="diary-form" onSubmit={submit}>
          <label className="block text-sm">Date<input aria-label="Date" type="date" className={fieldClass} value={diaryDate} {...textHandlers(setDiaryDate)} required /></label>
          <label className="mt-3 block text-sm">Weather<input aria-label="Weather" className={fieldClass} value={weather} {...textHandlers(setWeather)} /></label>
          {area("Work Done", workDone, setWorkDone)}
          {area("Visitors", visitors, setVisitors)}
          <label className="mt-3 block text-sm">Labour Count<input aria-label="Labour Count" inputMode="numeric" className={fieldClass} value={labour} {...textHandlers(setLabour)} /></label>
          {area("Issues", issues, setIssues)}
          {area("Instructions", instructions, setInstructions)}
          {area("Material Received", materialReceived, setMaterialReceived)}
          {area("Remarks", remarks, setRemarks)}
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save entry"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/site-diary", projectId)}>Back to the site diary</a></p>
    </Screen>
  );
}
