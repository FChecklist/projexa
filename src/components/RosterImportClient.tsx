"use client";

// R67 D-34 (R-091): bulk roster load. Adding 38 workers one form at a time is
// the reason real rosters never got entered, and every trade-wise number
// downstream was computed over a roster that did not exist.
//
// Nothing is parsed in the browser: the preview comes from the SAME server
// parse (?dryRun=1) that the real import runs, because PROJEXA must not gain an
// XLSX library and a second parser would be a second set of rules that can
// disagree with the one that imports. Same posture as the BOQ import screen.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency";

export const EXPECTED_COLUMNS_SENTENCE =
  "Columns expected: ID, Name, Trade, Company, Daily Rate. ID may be left blank -- a worker number is generated.";

const ACCEPTED_EXTENSIONS = [".xlsx", ".csv"] as const;

export type RosterPreviewRow = {
  employeeCode: string | null;
  name: string;
  trade: string | null;
  company: string | null;
  dailyRate: number;
  sheetRow: number;
  skipped: boolean;
};

export type RosterRowIssue = { row: number; message: string; blocking: boolean };

type DryRun = {
  rows: RosterPreviewRow[];
  issues: RosterRowIssue[];
  summary: { importable: number; skipped: number; label: string; totalRows: number };
};

export default function RosterImportClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const currencies = useCurrencies();
  const currency = currencyLabel(undefined, currencies);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);

  const importable = preview?.summary.importable ?? 0;
  // "Blocking" here is FILE-level, not row-level. A row that cannot be written
  // is skipped and named -- the primary says so out loud ("Import 38 rows
  // (2 skipped)") rather than refusing the other 38 because two are wrong.
  const importDisabledReason = !file
    ? "Choose a file"
    : parsing
      ? "Reading the file…"
      : !preview
        ? "Choose a file"
        : importable === 0
          ? "No usable rows in this file"
          : importing
            ? `Importing ${importable} rows…`
            : undefined;

  function isAccepted(candidate: File): boolean {
    const name = candidate.name.toLowerCase();
    return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  }

  async function chooseFile(candidate: File) {
    if (!isAccepted(candidate)) {
      setMessages([{ level: "error", text: `${candidate.name} is not an .xlsx or .csv file.` }]);
      return;
    }
    setFile(candidate);
    setMessages([]);
    await runDryRun(candidate);
  }

  /** The preview. Reads the file on the SERVER, through the same parser the real import uses. */
  async function runDryRun(candidate: File) {
    setParsing(true);
    setPreview(null);
    try {
      const body = new FormData();
      body.set("file", candidate);
      body.set("projectId", projectId);
      const res = await fetch("/api/labour-roster/import?dryRun=1", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't read this spreadsheet");
      setPreview({
        rows: data.rows ?? [],
        issues: data.issues ?? [],
        summary: data.summary ?? { importable: 0, skipped: 0, label: "Import 0 rows", totalRows: 0 },
      });
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't read this spreadsheet" }]);
    } finally {
      setParsing(false);
    }
  }

  async function runImport() {
    if (!file || !preview) return;
    setImporting(true);
    setMessages([]);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("projectId", projectId);
      const res = await fetch("/api/labour-roster/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't import this roster");

      const parts = [`Imported ${data.imported} worker${data.imported === 1 ? "" : "s"}`];
      if (data.skipped > 0) parts.push(`${data.skipped} skipped`);
      if (Array.isArray(data.failures) && data.failures.length > 0) parts.push(`${data.failures.length} could not be saved`);
      if (Array.isArray(data.unmatchedCompanies) && data.unmatchedCompanies.length > 0) {
        parts.push(`no vendor on file for ${data.unmatchedCompanies.join(", ")}`);
      }
      // Carried in the URL, not held in this screen's own band: this component
      // unmounts with the navigation, so its band would vanish with it.
      router.push(`/labour?projectId=${projectId}&tab=roster&imported=${encodeURIComponent(parts.join(" · "))}`);
    } catch (err) {
      // The preview is deliberately KEPT -- the user's file and the rows they
      // were looking at survive a failed import.
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't import this roster" }]);
    } finally {
      setImporting(false);
    }
  }

  const issuesByRow = new Map<number, RosterRowIssue[]>();
  for (const issue of preview?.issues ?? []) {
    issuesByRow.set(issue.row, [...(issuesByRow.get(issue.row) ?? []), issue]);
  }

  return (
    <KitObjectScreen
      breadcrumb="Labour / Import Workers"
      title="Import Workers from Excel"
      mode="create"
      hasDraft={false}
      onSave={runImport}
      onCancel={() => router.push(`/labour?projectId=${projectId}`)}
      onBack={() => router.push(`/labour?projectId=${projectId}`)}
      saveDisabled={!!importDisabledReason}
      saveDisabledReason={importDisabledReason ?? preview?.summary.label}
      messages={messages}
    >
      <div className="space-y-4 px-4 py-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void chooseFile(dropped);
          }}
          className={`rounded-md border border-dashed p-6 text-center ${dragging ? "border-px-steel bg-px-cloud" : "border-px-border2"}`}
        >
          <p className="text-[13px] text-px-ink">Drop an .xlsx or .csv here, or choose a file.</p>
          <input
            ref={fileInput}
            type="file"
            aria-label="Roster spreadsheet"
            accept=".xlsx,.csv"
            className="mt-3 mx-auto block text-[13px]"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void chooseFile(chosen);
            }}
          />
          <p className="mt-3 text-[11.5px] text-px-muted">{EXPECTED_COLUMNS_SENTENCE}</p>
        </div>

        {parsing && <p className="text-[13px] text-px-muted">Reading the file…</p>}

        {preview && (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-px-ink">{preview.summary.label}</p>

            {preview.issues.length > 0 && (
              <ul className="space-y-0.5">
                {preview.issues.map((issue, i) => (
                  <li key={`${issue.row}-${i}`} className={issue.blocking ? "text-[12px] text-px-error" : "text-[12px] text-px-muted"}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}

            <div className="overflow-x-auto rounded-md border border-px-border2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">Daily Rate</TableHead>
                    <TableHead>Problem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => {
                    const rowIssues = issuesByRow.get(row.sheetRow) ?? [];
                    return (
                      <TableRow key={row.sheetRow} className={row.skipped ? "opacity-60" : undefined}>
                        <TableCell className="text-px-muted">{row.sheetRow}</TableCell>
                        <TableCell className="font-mono text-[11px]">{row.employeeCode ?? "auto"}</TableCell>
                        <TableCell>{row.name || "–"}</TableCell>
                        <TableCell className="text-px-muted">{row.trade ?? "–"}</TableCell>
                        <TableCell className="text-px-muted">{row.company ?? "–"}</TableCell>
                        <TableCell className="text-right tabular-nums">{currency}{row.dailyRate}</TableCell>
                        <TableCell className={rowIssues.some((i) => i.blocking) ? "text-[12px] text-px-error" : "text-[12px] text-px-muted"}>
                          {rowIssues.map((i) => i.message.replace(/^Row \d+: /, "")).join("; ") || "–"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {preview.summary.skipped > 0 && (
              <p className="text-[11.5px] text-px-muted">
                Rows with a problem are dimmed above and are not imported. Everything else is.
              </p>
            )}
          </div>
        )}
      </div>
    </KitObjectScreen>
  );
}
