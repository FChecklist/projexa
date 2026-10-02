"use client";

// LOCAL-FIRST shell, one progress entry (/work-progress/:id) from the laptop's own copy. Read-only offline: the online page's edit
// (update_progress_entry) and delete are not wired here yet (see the package report), and photos live in Supabase storage.

import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Num, Screen, StateMessage, withProject } from "./DeliveryParts";
import type { WorkProgressEntryData } from "./work-progress-adapter";

export default function WorkProgressEntryScreen({ data }: ShellScreenProps<WorkProgressEntryData>) {
  const back = { href: "/work-progress", label: "Back to Work Progress" };
  if (data.state !== "local") return <StateMessage testId="work-progress-entry" title="Progress entry" state={data.state} what="entry" back={back} />;
  const e = data.entry;
  const facts: [string, React.ReactNode][] = [
    ["Date", e.entryDate],
    ["Activity", e.activityName ?? DASH],
    ["BOQ line", e.boqLabel ?? DASH],
    ["Qty done", <><Num value={e.quantityDone} />{e.unit ? ` ${e.unit}` : ""}</>],
    ["% complete", <Num key="pct" value={e.percentComplete} suffix="%" />],
    ["Basis", e.entryBasis === "SNAPSHOT" ? "Total to date" : e.entryBasis === "DELTA" ? "Today's work" : DASH],
    ["Remarks", e.remarks ?? DASH],
  ];
  if (data.activityPlanned && data.activityPlanned.quantity !== null) facts.push(["Activity planned", <><Num value={data.activityPlanned.quantity} />{data.activityPlanned.unit ? ` ${data.activityPlanned.unit}` : ""}</>]);
  return (
    <Screen testId="work-progress-entry" state="local" title={`Progress entry · ${e.entryDate}`}>
      <CopyNote testId="work-progress-entry-copy-note" syncedAt={data.syncedAt} />
      <dl className="mt-4 grid max-w-xl grid-cols-[10rem_1fr] gap-y-2 rounded-lg border border-black/10 bg-white p-4 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-px-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-px-muted">Photos and changes to this entry are made while you are online.</p>
      <p className="mt-3 text-sm">
        <a className="text-px-ink underline underline-offset-2" href={withProject("/work-progress", data.projectId)}>Back to Work Progress</a>
      </p>
    </Screen>
  );
}
