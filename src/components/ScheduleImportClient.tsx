"use client";

// R67 lane D22 (item D-48, rec R-123) -- THE PROGRAMME IMPORT SCREEN.
//
// Every contractor's programme arrives as a spreadsheet and PROJEXA could not
// take one: the only route that mentioned it posted to a VERIDIAN path that
// has never existed. The backend half of this item built the real endpoint;
// this is the screen in front of it.
//
// NO XLSX LIBRARY IS ADDED HERE. The file is posted as FormData and parsed
// server-side, and the preview below is VERIDIAN's real reading of it
// (dryRun=true) -- the same reading that gets committed, so the preview cannot
// disagree with the result.
//
// Three states, and the middle one is the point: a programme is the document
// the whole project is planned against, so nobody should be asked to commit
// one sight-unseen.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload } from "lucide-react";
import { errorMessage } from "@/lib/fetch-json";
import { setFooterMessage } from "@/lib/footer-message";

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

const MAPPING_LABELS: Record<string, string> = {
  activity: "Activity", startDate: "Start", finishDate: "Finish",
  duration: "Duration", predecessor: "Predecessor", weight: "Weight", boqCode: "BOQ code",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function ScheduleImportClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DryRunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setPreview(null);
    setError(null);
    if (!chosen) return;
    setBusy(true);
    try {
      setPreview(await post(chosen, true) as DryRunResponse);
    } catch (err) {
      setError(errorMessage(err, "Couldn't read this file"));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!file || !preview) return;
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

  const blockingCount = preview?.blockingErrors.length ?? 0;
  const importDisabledReason = !file
    ? "Choose a file"
    : busy
      ? "Importing…"
      : blockingCount > 0
        ? `Fix ${plural(blockingCount, "blocking error", "blocking errors")}`
        : null;

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p role="alert" className="text-sm text-px-error">{error}</p>
            <Button variant="outline" size="sm" onClick={() => (preview ? onImport() : file && onFileChosen(file))}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {!preview && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-px-muted">
              One row per activity. Predecessors name another activity in the same file; a BOQ code links the
              activity to the scope line it delivers.
            </p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-px-border2 p-8 text-center">
              <Upload className="size-6 text-px-muted" aria-hidden="true" />
              <span className="text-sm font-medium">Choose a .xlsx or .csv file</span>
              <span className="text-[12px] text-px-muted">{busy ? "Reading…" : "or drop it here"}</span>
              <input
                type="file" accept=".xlsx,.xls,.csv" className="sr-only"
                aria-label="Programme spreadsheet"
                onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-[12.5px]">
              <a className="text-px-steel underline underline-offset-2" href="/templates/programme-import-template.csv" download>
                Download template
              </a>
              <span className="text-px-muted"> — Activity | Start | Finish | Duration | Predecessor | Weight | BOQ Code</span>
            </p>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm font-medium">
              {plural(preview.activities.length, "activity", "activities")}, {plural(preview.milestoneCount, "milestone", "milestones")}, {plural(preview.warnings.length, "warning", "warnings")}
            </p>

            <p className="text-[12.5px] text-px-muted">
              {preview.dateInterpretation}. Detected columns:{" "}
              {Object.entries(preview.mapping)
                .filter(([, header]) => !!header)
                .map(([field, header]) => `${MAPPING_LABELS[field] ?? field} → ${header}`)
                .join(", ") || "none"}
            </p>

            {/* Blocking errors in rose: nothing can be imported until they are
                fixed in the file. Warnings in clay: imported, but differently
                from what the sheet literally said. */}
            {preview.blockingErrors.length > 0 && (
              <ul className="space-y-1 text-[12.5px] text-px-error" role="alert">
                {preview.blockingErrors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {preview.warnings.length > 0 && (
              <ul className="space-y-1 text-[12.5px] text-px-warning">
                {preview.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-right">Row</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Finish</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Predecessor</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead>BOQ code</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.activities.map((a) => (
                    <TableRow key={a.rowNumber}>
                      <TableCell className="text-right text-px-muted">{a.rowNumber}</TableCell>
                      <TableCell className="font-medium">
                        {a.name}
                        {a.isMilestone && <span className="ml-2 text-[10px] text-px-muted">milestone</span>}
                      </TableCell>
                      <TableCell>{a.startDate ?? "—"}</TableCell>
                      <TableCell>{a.finishDate ?? "—"}</TableCell>
                      <TableCell className="text-right">{a.durationDays ?? "—"}</TableCell>
                      <TableCell className="text-px-muted">{a.predecessorNames.join(", ") || "—"}</TableCell>
                      <TableCell className="text-right">{a.weight ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[11px]">{a.boqCode ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={onImport} disabled={!!importDisabledReason} title={importDisabledReason ?? undefined}>
                Import ({plural(preview.activities.length, "activity", "activities")})
              </Button>
              {importDisabledReason && <p className="text-[12.5px] text-px-muted">{importDisabledReason}</p>}
              <Button variant="ghost" onClick={() => { setPreview(null); setFile(null); }}>Choose a different file</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
