"use client";

// LOCAL-FIRST shell, Work Progress (/work-progress): the Daily Entry tab (the entries list and the entry form) from the laptop's own
// copy, and the Analytics / Report tabs as what they honestly are offline: the server's calculations, recalculated when online, with
// the laptop's own entries downloadable as CSV in the meantime.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { recordProgressOffline } from "./delivery-writes";
import { localDay } from "./delivery-local";
import { CopyNote, DASH, Num, SaveNote, Screen, ServerOnly, StateMessage, Tabs, Waiting, fieldClass, projectName, useLocalSave, withProject } from "./DeliveryParts";
import { progressCsv, type WorkProgressData } from "./work-progress-adapter";

const TABS = [
  { id: "entry", label: "Daily Entry" },
  { id: "analytics", label: "Analytics" },
  { id: "report", label: "Report" },
] as const;

const NEEDS_SERVER_TEXT = {
  several_activities: "This project has more than one activity, and an entry kept on the laptop cannot say which one yet. Record progress while you are online.",
  not_synced: "The project's activities and BOQ lines have not finished copying to this laptop yet, so an entry cannot be kept here.",
  no_lines: "This project has no BOQ line on this laptop to record progress against.",
} as const;

export default function WorkProgressScreen({ shell, query, data }: ShellScreenProps<WorkProgressData>) {
  const title = "Work Progress";
  if (data.state !== "local") return <StateMessage testId="work-progress" title={title} state={data.state} what="entry" />;
  const name = projectName(shell, data.projectId);
  const tab = TABS.some((t) => t.id === query.get("tab")) ? query.get("tab")! : "entry";

  return (
    <Screen testId="work-progress" state="local" title={`${title}${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="work-progress-copy-note" syncedAt={data.syncedAt} />
      <Tabs tabs={TABS} active={tab} base="/work-progress" projectId={data.projectId} />
      {tab === "entry" ? <EntryTab shell={shell} data={data} /> : <ServerTab shell={shell} data={data} tab={tab} />}
    </Screen>
  );
}

type Local = Extract<WorkProgressData, { state: "local" }>;

function EntryTab({ shell, data }: { shell: ShellScreenProps["shell"]; data: Local }) {
  return (
    <>
      {data.form.mode === "offline" ? (
        <EntryForm shell={shell} projectId={data.projectId} form={data.form} />
      ) : (
        <p className="mt-4 text-sm text-px-muted" data-testid="work-progress-form-needs-server">{NEEDS_SERVER_TEXT[data.form.reason]}</p>
      )}
      <EntriesTable data={data} />
    </>
  );
}

function EntryForm({ shell, projectId, form }: { shell: ShellScreenProps["shell"]; projectId: string; form: Extract<Local["form"], { mode: "offline" }> }) {
  const [lineId, setLineId] = useState("");
  const [by, setBy] = useState<"quantity" | "percent">("quantity");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(localDay());
  const [remarks, setRemarks] = useState("");
  const { saving, note, save } = useLocalSave(shell);
  const line = form.lines.find((l) => l.id === lineId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    const ok = await save(() =>
      recordProgressOffline(shell.data, {
        projectId, boqLineItemId: lineId, entryDate: date, remarks,
        ...(by === "quantity" ? { quantityDone: n } : { percent: n }),
      })
    );
    if (ok) {
      setValue("");
      setRemarks("");
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="work-progress-form">
      <p className="text-xs text-px-muted">
        {form.activity ? `Activity: ${form.activity.name}. ` : ""}Kept on this laptop as today&apos;s work (added to the total) and sent when you are connected. A quantity is turned into a percent by the server.
      </p>
      <label className="mt-3 block text-sm">
        BOQ line
        <select aria-label="BOQ line" className={fieldClass} value={lineId} onChange={(e) => setLineId(e.target.value)} required>
          <option value="">Choose a line</option>
          {form.lines.map((l) => (
            <option key={l.id} value={l.id}>{l.itemCode ? `${l.itemCode} · ${l.description}` : l.description}</option>
          ))}
        </select>
      </label>
      <fieldset className="mt-3 text-sm">
        <legend>Record as</legend>
        <label className="mr-4"><input type="radio" name="by" checked={by === "quantity"} onChange={() => setBy("quantity")} /> Quantity{line?.unit ? ` (${line.unit})` : ""}</label>
        <label><input type="radio" name="by" checked={by === "percent"} onChange={() => setBy("percent")} /> % complete</label>
      </fieldset>
      <label className="mt-3 block text-sm">
        {by === "quantity" ? "Quantity done" : "% complete"}
        <input aria-label={by === "quantity" ? "Quantity done" : "% complete"} className={fieldClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <label className="mt-3 block text-sm">
        Date
        <input aria-label="Date" type="date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="mt-3 block text-sm">
        Remarks
        <input aria-label="Remarks" className={fieldClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </label>
      <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save entry"}</Button>
      <SaveNote note={note} />
    </form>
  );
}

function EntriesTable({ data }: { data: Local }) {
  if (data.entries.length === 0) return <p className="mt-4 text-sm text-px-muted">No progress recorded on this project yet.</p>;
  const unknown = (known: boolean) => (known ? DASH : "Not on this laptop yet");
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead>BOQ line</TableHead>
            <TableHead className="text-right">Qty done</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">% complete</TableHead>
            <TableHead>Basis</TableHead>
            <TableHead>Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.entries.map((e) => (
            <TableRow key={e.id} data-testid="work-progress-row">
              <TableCell>
                {e.waiting ? e.entryDate : <a className="underline-offset-2 hover:underline" href={withProject(`/work-progress/${encodeURIComponent(e.id)}`, data.projectId)}>{e.entryDate}</a>}
                <Waiting on={e.waiting} />
              </TableCell>
              <TableCell>{e.activityName ?? unknown(data.namesKnown.activities)}</TableCell>
              <TableCell>{e.boqLabel ?? (e.boqLineItemId ? unknown(data.namesKnown.lines) : DASH)}</TableCell>
              <TableCell className="text-right"><Num value={e.quantityDone} /></TableCell>
              <TableCell>{e.unit ?? DASH}</TableCell>
              <TableCell className="text-right">{e.percentComplete === null && e.waiting ? "Worked out when sent" : <Num value={e.percentComplete} suffix="%" />}</TableCell>
              <TableCell>{e.entryBasis === "SNAPSHOT" ? "Total to date" : e.entryBasis === "DELTA" ? "Today's work" : DASH}</TableCell>
              <TableCell>{e.remarks ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ServerTab({ shell, data, tab }: { shell: ShellScreenProps["shell"]; data: Local; tab: string }) {
  function download() {
    const blob = new Blob([progressCsv(data.entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `work-progress-${data.projectId}-${localDay()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="mt-4" data-testid={`work-progress-${tab}`}>
      <p className="text-sm text-px-muted">
        {tab === "report"
          ? "The Work Progress Report (scope-, category-, manpower- and vendor-wise, with its PDF and Excel) is calculated by the server: recalculated when online."
          : "The analytics (category progress weighted by value) are calculated by the server: recalculated when online."}
      </p>
      <ServerOnly shell={shell} what="" path="/work-progress" />
      <Button type="button" variant="outline" className="mt-3" onClick={download} data-testid="work-progress-csv">
        Download this laptop&apos;s entries (CSV)
      </Button>
    </div>
  );
}
