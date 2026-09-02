"use client";

// R67 lane D22 (item D-68, rec R-258) -- THE LABOUR ROSTER IMPORT SCREEN.
//
// The third of the three imports, and the one that hurt most: a roster arrives
// as a spreadsheet with a hundred names on it and PROJEXA's only way in was
// /labour/new, one worker at a time. Built on the shared ImportScreen, so a
// person who has imported a BOQ already knows how to do this.
//
// NO XLSX LIBRARY HERE, and none may be added: the file is posted as FormData
// and parsed server-side, and everything shown is VERIDIAN's real reading of it
// (dryRun=true) -- the same reading that gets committed.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/fetch-json";
import { setFooterMessage } from "@/lib/footer-message";
import ImportScreen, { UNMAPPED, type ImportField, type ImportPreview } from "@/components/ImportScreen";

type ParsedRosterRow = {
  rowNumber: number;
  employeeCode: string;
  employeeCodeGenerated: boolean;
  name: string;
  trade: string | null;
  skillLevel: string | null;
  company: string | null;
  dailyRate: number;
  errors: string[];
  warnings: string[];
  createVendorOffer: string | null;
};

type DryRunResponse = {
  rows: ParsedRosterRow[];
  mapping: Record<string, string | undefined>;
  headers: string[];
  totalRows: number;
  blockingErrors: string[];
  unknownCompanies: string[];
  fileName: string;
};

type CommitResponse = {
  createdRosterIds: string[];
  fileName: string;
  importSummary: { skippedRows: number; createdVendors: string[] };
};

const FIELDS: ImportField[] = [
  { key: "employeeCode", label: "ID" },
  { key: "name", label: "Name", required: true },
  { key: "trade", label: "Trade" },
  { key: "company", label: "Company" },
  { key: "dailyRate", label: "Daily Rate", required: true },
];

const PREVIEW_COLUMNS = ["ID", "Name", "Trade", "Company", "Daily Rate"];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function RosterImportClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<DryRunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipRowsWithErrors, setSkipRowsWithErrors] = useState(false);
  // field -> header. Empty until the user corrects something; the server's own
  // automatic match is the starting point and is what the preview reflects.
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // Creating vendor master records is a real side effect on the org, so it is
  // opt-in and explicit -- an offer on a row is an offer, not a decision.
  const [createVendors, setCreateVendors] = useState(false);

  const post = useCallback(async (chosen: File, dryRun: boolean, mappingOverride?: Record<string, string>) => {
    const body = new FormData();
    body.append("file", chosen);
    body.append("projectId", projectId);
    if (mappingOverride && Object.keys(mappingOverride).length > 0) {
      // UNMAPPED is this screen's way of saying "this field has no column"; the
      // server reads an empty string as that, so translate rather than sending
      // an internal sentinel over the wire.
      body.append("mapping", JSON.stringify(
        Object.fromEntries(Object.entries(mappingOverride).map(([k, v]) => [k, v === UNMAPPED ? "" : v]))
      ));
    }
    if (dryRun) body.append("dryRun", "true");
    else {
      if (skipRowsWithErrors) body.append("skipRowsWithErrors", "true");
      if (createVendors) body.append("createVendors", "true");
    }
    const res = await fetch("/api/labour/import", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? (dryRun ? "Couldn't read this file" : "Import failed - nothing was saved. Retry"));
    return data;
  }, [projectId, skipRowsWithErrors, createVendors]);

  async function onFileChosen(chosen: File | null) {
    setFile(chosen);
    setRaw(null);
    setError(null);
    setSkipRowsWithErrors(false);
    setCreateVendors(false);
    setMapping({});
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
      const result = await post(file, false, mapping) as CommitResponse;
      // The receipt lands on /labour, where the user is about to be. The import
      // runs in one transaction, so this count is what is really there.
      const created = result.importSummary.createdVendors.length;
      setFooterMessage("/labour", {
        level: "success",
        text: `Imported ${plural(result.createdRosterIds.length, "worker", "workers")} from ${result.fileName}` +
          (result.importSummary.skippedRows > 0 ? `, ${result.importSummary.skippedRows} skipped` : "") +
          (created > 0 ? `, ${plural(created, "vendor", "vendors")} created` : ""),
      });
      router.push(`/labour?projectId=${encodeURIComponent(projectId)}`);
    } catch (err) {
      // Stays here. The commit is one transaction, so "nothing was saved" is the
      // literal truth and Retry is safe.
      setError(errorMessage(err, "Import failed - nothing was saved. Retry"));
      setBusy(false);
    }
  }

  const preview: ImportPreview | null = raw
    ? {
        fileName: raw.fileName,
        headers: raw.headers,
        mapping: raw.mapping,
        blockingErrors: raw.blockingErrors,
        notices: raw.unknownCompanies.map((c) => `Create vendor '${c}' — tick "Create the vendors named below" to add it, or leave the worker unlinked`),
        rows: raw.rows.map((r) => ({
          key: r.rowNumber,
          rowNumber: r.rowNumber,
          cells: [
            <span key="code" className="font-mono text-[11px]">
              {r.employeeCode}
              {r.employeeCodeGenerated && <span className="ml-1 text-px-muted">(auto)</span>}
            </span>,
            r.name || "—",
            r.trade ?? "—",
            <span key="company">
              {r.company ?? "—"}
              {r.createVendorOffer && <span className="ml-1 text-[11px] text-px-warning">{r.createVendorOffer}</span>}
            </span>,
            r.dailyRate,
          ],
          errors: r.errors,
          warnings: r.warnings,
        })),
      }
    : null;

  return (
    <ImportScreen
      title="Import roster"
      helpText="One row per worker. A blank ID is numbered W-0001 onwards. A company that is not yet a vendor is offered, never created behind your back."
      templateHref="/templates/roster-import-template.xlsx"
      templateColumns="ID | Name | Trade | Company | Daily Rate"
      fields={FIELDS}
      previewColumns={PREVIEW_COLUMNS}
      preview={preview}
      busy={busy}
      error={error}
      skipRowsWithErrors={skipRowsWithErrors}
      onSkipChange={setSkipRowsWithErrors}
      onFileChosen={onFileChosen}
      // Correcting a column re-runs the SERVER's reading of the file, never a
      // second client-side interpretation of it -- the preview and the commit
      // must be the same parse.
      onMappingChange={(field, header) => {
        const next = { ...mapping, [field]: header };
        setMapping(next);
        if (file) {
          setBusy(true);
          post(file, true, next)
            .then((data) => setRaw(data as DryRunResponse))
            .catch((err) => setError(errorMessage(err, "Couldn't read this file")))
            .finally(() => setBusy(false));
        }
      }}
      onImport={onImport}
      onRetry={() => (raw ? onImport() : file && onFileChosen(file))}
      rowNoun={{ one: "worker", many: "workers" }}
      extraControls={
        raw && raw.unknownCompanies.length > 0 ? (
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={createVendors} onChange={(e) => setCreateVendors(e.target.checked)} />
            Create the {plural(raw.unknownCompanies.length, "vendor", "vendors")} named below: {raw.unknownCompanies.join(", ")}
          </label>
        ) : undefined
      }
    />
  );
}
