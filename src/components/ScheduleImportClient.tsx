"use client";

// R67 lane D22 (item D-48, rec R-123; rebuilt on the shared screen by item
// D-68, rec R-258) -- THE PROGRAMME IMPORT SCREEN.
//
// Every contractor's programme arrives as a spreadsheet and PROJEXA could not
// take one: the only route that mentioned it posted to a VERIDIAN path that
// has never existed. D-48 built the real endpoint and this screen; D-68 then
// asked for ONE import screen behind all three of this app's imports, so the
// chrome is now ImportScreen and this file is the programme's own knowledge:
// which columns it understands, how an activity row reads, and the two facts
// no other import has -- the milestone count and how the dates were read.
//
// NO XLSX LIBRARY IS ADDED HERE. The file is posted as FormData and parsed
// server-side, and the preview is VERIDIAN's real reading of it (dryRun=true)
// -- the same reading that gets committed, so the preview cannot disagree with
// the result.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/fetch-json";
import { setFooterMessage } from "@/lib/footer-message";
import { attributeRowMessages } from "@/lib/import-row-messages";
import ImportScreen, { type ImportField, type ImportPreview } from "@/components/ImportScreen";

type ParsedActivity = {
  rowNumber: number;
  name: string;
  startDate: string | null;
  finishDate: string | null;
  durationDays: number | null;
  predecessorNames: string[];
  weight: number | null;
  boqCode: string | null;
  isMilestone: boolean;
};

type DryRunResponse = {
  activities: ParsedActivity[];
  warnings: string[];
  blockingErrors: string[];
  mapping: Record<string, string | undefined>;
  totalRows: number;
  milestoneCount: number;
  dateInterpretation: string;
  fileName: string;
};

type CommitResponse = {
  createdIssueIds: string[];
  dependencyCount: number;
  boqLinkCount: number;
  unmatchedBoqCodes: string[];
  fileName: string;
};

const FIELDS: ImportField[] = [
  { key: "activity", label: "Activity", required: true },
  { key: "startDate", label: "Start" },
  { key: "finishDate", label: "Finish" },
  { key: "duration", label: "Duration" },
  { key: "predecessor", label: "Predecessor" },
  { key: "weight", label: "Weight" },
  { key: "boqCode", label: "BOQ code" },
];

const PREVIEW_COLUMNS = ["Activity", "Start", "Finish", "Duration", "Predecessor", "Weight", "BOQ code"];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function ScheduleImportClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<DryRunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipRowsWithErrors, setSkipRowsWithErrors] = useState(false);

  const post = useCallback(async (chosen: File, dryRun: boolean) => {
    const body = new FormData();
    body.append("file", chosen);
    body.append("projectId", projectId);
    if (dryRun) body.append("dryRun", "true");
    const res = await fetch("/api/schedule/import", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? (dryRun ? "Couldn't read this file" : "Import failed - nothing was saved. Retry"));
    return data;
  }, [projectId]);

  async function onFileChosen(chosen: File | null) {
    setFile(chosen);
    setRaw(null);
    setError(null);
    setSkipRowsWithErrors(false);
    if (!chosen) return;
    setBusy(true);
    try {
      setRaw(await post(chosen, true) as DryRunResponse);
    } catch (err) {
      setError(errorMessage(err, "Couldn't read this file"));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!file || !raw) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post(file, false) as CommitResponse;
      // The receipt lands on /schedule, where the user is about to be. The
      // import runs in one transaction, so this count is what is really there.
      setFooterMessage("/schedule", {
        level: "success",
        text: `Imported ${plural(result.createdIssueIds.length, "activity", "activities")} from ${result.fileName}`,
      });
      router.push(`/schedule?projectId=${encodeURIComponent(projectId)}`);
    } catch (err) {
      // Stays here. The commit is one transaction, so "nothing was saved" is
      // the literal truth and Retry is safe.
      setError(errorMessage(err, "Import failed - nothing was saved. Retry"));
      setBusy(false);
    }
  }

  const preview: ImportPreview | null = raw
    ? (() => {
        // Blocking errors are rose and per-row where they name a row; warnings
        // are clay -- the activity imports, just not exactly as the sheet said.
        const blocking = attributeRowMessages(raw.blockingErrors);
        const warned = attributeRowMessages(raw.warnings);
        const rowsByNumber = new Map(raw.activities.map((a) => [a.rowNumber, a]));
        // A row named only in an error never reaches `activities`, so it has to
        // be synthesised or it would be invisible on the screen that exists to
        // show it.
        const allRowNumbers = [...new Set([
          ...raw.activities.map((a) => a.rowNumber),
          ...blocking.byRow.keys(),
          ...warned.byRow.keys(),
        ])].sort((a, b) => a - b);

        return {
          fileName: raw.fileName,
          headers: [...new Set(Object.values(raw.mapping).filter((h): h is string => !!h))],
          mapping: raw.mapping,
          blockingErrors: blocking.sheetLevel,
          notices: [raw.dateInterpretation, ...warned.sheetLevel],
          rows: allRowNumbers.map((rowNumber) => {
            const a = rowsByNumber.get(rowNumber);
            return {
              key: rowNumber,
              rowNumber,
              cells: a
                ? [
                    <span key="name" className="font-medium">
                      {a.name}
                      {a.isMilestone && <span className="ml-2 text-[10px] text-px-muted">milestone</span>}
                    </span>,
                    a.startDate ?? "—",
                    a.finishDate ?? "—",
                    a.durationDays ?? "—",
                    a.predecessorNames.join(", ") || "—",
                    a.weight ?? "—",
                    <span key="boq" className="font-mono text-[11px]">{a.boqCode ?? "—"}</span>,
                  ]
                : PREVIEW_COLUMNS.map(() => "—"),
              errors: blocking.byRow.get(rowNumber) ?? [],
              warnings: warned.byRow.get(rowNumber) ?? [],
            };
          }),
        };
      })()
    : null;

  return (
    <ImportScreen
      title="Import programme"
      helpText="One row per activity. Predecessors name another activity in the same file; a BOQ code links the activity to the scope line it delivers."
      templateHref="/templates/programme-import-template.xlsx"
      templateColumns="Activity | Start | Finish | Duration | Predecessor | Weight | BOQ Code"
      fields={FIELDS}
      previewColumns={PREVIEW_COLUMNS}
      preview={preview}
      busy={busy}
      error={error}
      skipRowsWithErrors={skipRowsWithErrors}
      onSkipChange={setSkipRowsWithErrors}
      // A programme is a chain, not a list: dropping an activity another one
      // depends on imports a dependency graph with a hole in it, which is worse
      // than importing nothing. The endpoint refuses it too -- the toggle says
      // so rather than offering something the server will reject.
      skipDisabledReason="a programme imports whole - an activity another one waits on cannot be skipped"
      onFileChosen={onFileChosen}
      // The programme importer matches its columns by synonym and takes no
      // mapping override; a file it cannot read says which column is missing.
      onMappingChange={() => undefined}
      onImport={onImport}
      onRetry={() => (raw ? onImport() : file && onFileChosen(file))}
      rowNoun={{ one: "activity", many: "activities" }}
      extraSummary={raw ? `${plural(raw.milestoneCount, "milestone", "milestones")}, ${plural(raw.warnings.length, "warning", "warnings")}` : undefined}
    />
  );
}
