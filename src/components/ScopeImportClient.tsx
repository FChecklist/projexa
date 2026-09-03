"use client";

// R67 D-25 (R-064). The BOQ Excel importer has shipped end to end for months --
// construction-boq-import-service.parseBoqSpreadsheet, POST
// /api/v1/projexa/scope/import and this repo's own proxy -- and the ONLY thing
// missing was a screen. So nothing is built on the parse side here: the
// preview comes from the SAME server parse (?dryRun=1) that the real import
// runs, and PROJEXA gains no XLSX library. A browser-side SheetJS preview would
// have been a second set of rules that can disagree with the one that imports.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/fetch-json";
import { revisionLabel } from "@/lib/boq-lineage";
import { formatAmount } from "@/lib/boq-helpers";

export const EXPECTED_COLUMNS_SENTENCE =
  "Columns expected: Category, Code, Description, Unit, Qty, Rate (Amount is calculated). Sub-tasks: Parent Item Code + Breakdown %.";

const ACCEPTED_EXTENSIONS = [".xlsx", ".csv"] as const;

export type PreviewRow = {
  category: string | null;
  code: string | null;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
  parentItemCode: string | null;
  breakdownPercentage: number | null;
};

export type RowIssue = { row: number; message: string; blocking: boolean };

type DryRun = {
  rows: PreviewRow[];
  issues: RowIssue[];
  summary: { totalRows: number; readyLines: number; rowsWithErrors: number };
};

export type ExistingBoq = { id: string; title: string; version: number; status: string };

/** "3 lines ready, 1 with errors" / "3 lines ready, 0 with errors" -- always both halves, so a clean file says so out loud. */
export function summaryLine(readyLines: number, rowsWithErrors: number): string {
  return `${readyLines} line${readyLines === 1 ? "" : "s"} ready, ${rowsWithErrors} with error${rowsWithErrors === 1 ? "" : "s"}`;
}

export default function ScopeImportClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement | null>(null);
  // The project's current BOQs, so an import can be offered as a revision of
  // the latest instead of a second, competing baseline. Fetched HERE rather
  // than on the server so the /scope list's known slowness never delays the
  // file input, and so a failure degrades to "no revision option offered"
  // instead of blocking the import.
  const [existingBoqs, setExistingBoqs] = useState<ExistingBoq[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  // null = import as a NEW BOQ. A BOQ id = import as the next revision of it.
  const [reviseOf, setReviseOf] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ boqs?: ExistingBoq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`)
      .then((data) => setExistingBoqs(data.boqs ?? []))
      .catch(() => setExistingBoqs([]));
  }, [projectId]);

  // The revision candidate: the latest non-superseded BOQ, which is what
  // "Rev n of <title>" means to a user looking at the list.
  const latestBoq = useMemo(() => {
    if (existingBoqs.length === 0) return null;
    const live = existingBoqs.filter((b) => b.status !== "superseded");
    const pool = live.length > 0 ? live : existingBoqs;
    return pool.reduce((best, b) => (b.version > best.version ? b : best), pool[0]);
  }, [existingBoqs]);

  const blockingRows = useMemo(
    () => new Set((preview?.issues ?? []).filter((i) => i.blocking).map((i) => i.row)),
    [preview]
  );
  const issuesByRow = useMemo(() => {
    const map = new Map<number, RowIssue[]>();
    for (const issue of preview?.issues ?? []) {
      map.set(issue.row, [...(map.get(issue.row) ?? []), issue]);
    }
    return map;
  }, [preview]);

  const readyLines = preview?.summary.readyLines ?? 0;
  const importDisabledReason = !file
    ? "Choose a file"
    : parsing
      ? "Reading the file…"
      : !preview
        ? "Choose a file"
        : blockingRows.size > 0
          ? `${blockingRows.size} row${blockingRows.size === 1 ? "" : "s"} with errors`
          : readyLines === 0
            ? "No usable lines in this file"
            : importing
              ? `Importing ${readyLines} lines…`
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
    setTitle((current) => current || candidate.name.replace(/\.[^.]+$/, ""));
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
      const res = await fetch("/api/scope/import?dryRun=1", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't read this spreadsheet");
      setPreview({ rows: data.rows ?? [], issues: data.issues ?? [], summary: data.summary ?? { totalRows: 0, readyLines: 0, rowsWithErrors: 0 } });
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
      body.set("title", title.trim() || file.name.replace(/\.[^.]+$/, ""));
      if (reviseOf) body.set("parentBoqId", reviseOf);

      const res = await fetch("/api/scope/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't import this BOQ");
      const saved = data.boq as { id?: string; title?: string; version?: number } | undefined;
      if (!saved?.id) throw new Error("The scope service reported success but returned no saved BOQ. Nothing has been imported — please try again.");

      const importedLines = data.importSummary?.importedLineItems ?? preview.summary.readyLines;
      const notice = `Imported BOQ ${saved.title ?? title} · ${revisionLabel(saved.version ?? 1)} · ${importedLines} lines`;
      // Carried in the URL, not held in this screen's own band: this component
      // unmounts with the navigation, so its band would vanish with it (the
      // same reason MoMsClient reads ?deleted=).
      router.push(`/scope/${saved.id}?imported=${encodeURIComponent(notice)}`);
    } catch (err) {
      // The preview is deliberately KEPT -- the user's file selection and the
      // rows they were looking at survive a failed import.
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't import this BOQ" }]);
    } finally {
      setImporting(false);
    }
  }

  return (
    <KitObjectScreen
      breadcrumb="Scope / Import BOQ"
      title="Import BOQ from Excel"
      mode="create"
      hasDraft={false}
      onSave={runImport}
      onCancel={() => router.push(`/scope?projectId=${projectId}`)}
      onBack={() => router.push(`/scope?projectId=${projectId}`)}
      saveDisabled={!!importDisabledReason}
      saveDisabledReason={importDisabledReason}
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
            aria-label="BOQ spreadsheet"
            accept=".xlsx,.csv"
            className="mt-3 mx-auto block text-[13px]"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void chooseFile(chosen);
            }}
          />
          <p className="mt-3 text-[11.5px] text-px-muted">{EXPECTED_COLUMNS_SENTENCE}</p>
          {/* Built by VERIDIAN and relayed byte-for-byte -- PROJEXA must not
              gain an XLSX library. */}
          <a href="/api/scope/import/template" className="mt-2 inline-block text-[12px] underline text-px-steel">Download template</a>
        </div>

        <div className="max-w-md space-y-1.5">
          <Label htmlFor="import-title">BOQ title</Label>
          <Input
            id="import-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Defaults to the file name"
          />
        </div>

        {latestBoq && (
          <div className="rounded-md border border-px-border2 p-3">
            <p className="text-[13px] text-px-ink">
              Import as a new BOQ or as {revisionLabel(latestBoq.version + 1)} of &ldquo;{latestBoq.title}&rdquo;?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={reviseOf === null ? "default" : "outline"}
                onClick={() => setReviseOf(null)}
              >
                New BOQ
              </Button>
              <Button
                size="sm"
                variant={reviseOf === latestBoq.id ? "default" : "outline"}
                onClick={() => setReviseOf(latestBoq.id)}
              >
                {revisionLabel(latestBoq.version + 1)} of &ldquo;{latestBoq.title}&rdquo;
              </Button>
            </div>
          </div>
        )}

        {parsing && <p className="text-[13px] text-px-muted">Reading the file…</p>}

        {preview && (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-px-ink">
              {summaryLine(preview.summary.readyLines, blockingRows.size)}
            </p>

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
                    <TableHead>Category</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Parent Item Code</TableHead>
                    <TableHead className="text-right">Breakdown %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, i) => (
                    <TableRow key={`${row.code ?? "row"}-${i}`}>
                      <TableCell className="text-px-muted">{row.category ?? "–"}</TableCell>
                      <TableCell className="font-mono text-[11px]">{row.code ?? "–"}</TableCell>
                      <TableCell>{row.description}</TableCell>
                      <TableCell className="text-px-muted">{row.unit || "–"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(row.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(row.rate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAmount(row.amount)}</TableCell>
                      <TableCell className="text-px-muted">{row.parentItemCode ?? "–"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.breakdownPercentage ?? "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {issuesByRow.size > 0 && (
              <p className="text-[11.5px] text-px-muted">
                Rows with an error are listed above by their sheet row number and are not imported.
              </p>
            )}
          </div>
        )}
      </div>
    </KitObjectScreen>
  );
}
