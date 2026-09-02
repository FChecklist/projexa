"use client";

// R67 lane D22 (item D-52, rec R-176; rebuilt on the shared screen by item
// D-68, rec R-258) -- THE BOQ EXCEL IMPORT SCREEN.
//
// The importer itself has been shipped end to end for a while
// (construction-boq-import-service.parseBoqSpreadsheet, POST
// /api/v1/projexa/scope/import, this repo's own /api/scope/import proxy) and
// has never had a screen, so the only way to use it was a curl command.
//
// D-52 built this as its own three-step wizard. D-68 then asked for ONE import
// screen behind all three of this app's imports (BOQ, programme, roster), so
// that screen is now ImportScreen and this file is the BOQ's knowledge of
// itself: which columns it understands, how a row reads, and the one thing no
// other import has -- whether the file becomes Rev0 or a revision of an
// existing BOQ. D-52's own sentence, "N of M rows will import", is kept as the
// secondary summary line, because it says something D-68's sentence does not:
// how many of the file's rows the parser could use at all.
//
// NO XLSX LIBRARY IS ADDED HERE, and none may be: the file is posted as
// FormData and parsed server-side, and the preview is VERIDIAN's real reading
// of it (dryRun=true), not a second client-side parse that could disagree with
// what actually gets committed.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { withMoney } from "@/lib/money";
import { setFooterMessage } from "@/lib/footer-message";
import { attributeRowMessages } from "@/lib/import-row-messages";
import ImportScreen, { UNMAPPED, type ImportField, type ImportPreview } from "@/components/ImportScreen";
import type { Boq } from "@/lib/boq-helpers";

type PreviewRow = {
  index: number;
  itemCode?: string;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
  category?: string;
  parentItemCode?: string;
  breakdownPercentage?: number;
  status: "ok" | "warning";
  messages: string[];
};

type DryRunResponse = {
  dryRun: true;
  fileName: string;
  mapping: Record<string, string | undefined>;
  headers: string[];
  totalRows: number;
  warnings: string[];
  rows: PreviewRow[];
  willImport: number;
  totalParsed: number;
};

type CommitResponse = {
  boq: { id: string; title: string; version: number };
  importSummary: { totalRows: number; importedLineItems: number; totalValue: number; warnings: string[] };
};

// The five fields a BOQ line cannot be read without. Order is Sumeet's own
// column order, so the "2 required fields unmapped - Qty, Rate" sentence names
// them the way the sheet does.
const FIELDS: ImportField[] = [
  { key: "itemCode", label: "Code", required: true },
  { key: "description", label: "Description", required: true },
  { key: "quantity", label: "Qty", required: true },
  { key: "unit", label: "Unit", required: true },
  { key: "rate", label: "Rate", required: true },
  { key: "amount", label: "Amount" },
  { key: "parentItemCode", label: "Parent code" },
  { key: "breakdownPercentage", label: "Breakdown %" },
  { key: "subTask", label: "Sub task" },
  { key: "category", label: "Category" },
];

const PREVIEW_COLUMNS = ["Category", "Code", "Description", "Qty", "Unit", "Rate", "Amount"];

export default function ScopeImportClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  const [file, setFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<DryRunResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [target, setTarget] = useState<string>("rev0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipRowsWithErrors, setSkipRowsWithErrors] = useState(false);

  useEffect(() => {
    fetchJson<{ boqs: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`)
      .then((data) => setBoqs(data.boqs ?? []))
      // A project with no BOQ yet is the common first-import case, not an
      // error: the revision radio simply has nothing to offer.
      .catch(() => setBoqs([]));
  }, [projectId]);

  const runDryRun = useCallback(async (chosen: File, mappingOverride?: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", chosen);
      body.append("projectId", projectId);
      body.append("dryRun", "true");
      if (mappingOverride && Object.keys(mappingOverride).length > 0) {
        // UNMAPPED is the UI's way of saying "this field has no column"; the
        // server reads an empty string as that, so translate rather than
        // sending an internal sentinel over the wire.
        body.append("mapping", JSON.stringify(
          Object.fromEntries(Object.entries(mappingOverride).map(([k, v]) => [k, v === UNMAPPED ? "" : v]))
        ));
      }
      const res = await fetch("/api/scope/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't read this file");
      const parsed = data as DryRunResponse;
      setRaw(parsed);
      return parsed;
    } catch (err) {
      setError(errorMessage(err, "Couldn't read this file"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  async function onFileChosen(chosen: File | null) {
    setFile(chosen);
    setRaw(null);
    setMapping({});
    setSkipRowsWithErrors(false);
    if (!chosen) { setError(null); return; }
    await runDryRun(chosen);
  }

  async function onImport() {
    if (!file || !raw) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("projectId", projectId);
      if (Object.keys(mapping).length > 0) {
        body.append("mapping", JSON.stringify(
          Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v === UNMAPPED ? "" : v]))
        ));
      }
      if (target !== "rev0") body.append("parentBoqId", target);
      const res = await fetch("/api/scope/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Stays on the preview. The importer commits in one transaction, so a
        // failure really did write nothing -- saying so is what lets a user
        // press Retry without wondering whether half a BOQ is now in there.
        throw new Error(data.error ? `Import failed - nothing was saved. ${data.error}` : "Import failed - nothing was saved. Retry");
      }
      const { boq, importSummary } = data as CommitResponse;
      setFooterMessage(`/scope/${boq.id}`, {
        level: "success",
        text: `BOQ ${boq.title} v${boq.version} created - ${importSummary.importedLineItems} lines, ${withMoney(currencyCode, importSummary.totalValue)}`,
      });
      router.push(`/scope/${boq.id}`);
    } catch (err) {
      setError(errorMessage(err, "Import failed - nothing was saved. Retry"));
      setBusy(false);
    }
  }

  // The rows the parser could NOT use are reported as "Row N: ..." warnings
  // rather than as preview rows, so they are synthesised here -- a row a person
  // has to go and fix is exactly the thing that must not be invisible.
  const preview: ImportPreview | null = raw
    ? (() => {
        const { byRow, sheetLevel } = attributeRowMessages(raw.warnings);
        const parsedRows: ImportPreview["rows"] = raw.rows.map((row) => ({
          key: `parsed-${row.index}`,
          rowNumber: row.index,
          cells: [
            row.category ?? "—",
            <span key="code" className="font-mono text-[11px]">{row.itemCode ?? "—"}</span>,
            <span key="desc" className={row.parentItemCode ? "pl-4 text-px-muted" : ""}>{row.description}</span>,
            row.quantity,
            row.unit || "—",
            withMoney(currencyCode, row.rate),
            withMoney(currencyCode, row.amount),
          ],
          errors: [],
          warnings: row.status === "warning" ? row.messages : [],
        }));
        const errorRows: ImportPreview["rows"] = [...byRow.entries()].map(([rowNumber, messages]) => ({
          key: `unusable-${rowNumber}`,
          rowNumber,
          cells: PREVIEW_COLUMNS.map(() => "—"),
          errors: messages,
          warnings: [],
        }));
        return {
          fileName: raw.fileName,
          headers: raw.headers,
          mapping: raw.mapping,
          blockingErrors: [],
          notices: sheetLevel,
          rows: [...parsedRows, ...errorRows].sort((a, b) => a.rowNumber - b.rowNumber),
        };
      })()
    : null;

  return (
    <ImportScreen
      title="Import BOQ from Excel"
      helpText="One row per BOQ line. Sub-items use Parent code and Breakdown %."
      templateHref="/templates/boq-import-template.xlsx"
      templateColumns="S.No | Category | Code | Description | Qty | Unit | Rate | Amount | Parent code | Breakdown %"
      fields={FIELDS}
      previewColumns={PREVIEW_COLUMNS}
      preview={preview}
      busy={busy}
      error={error}
      skipRowsWithErrors={skipRowsWithErrors}
      onSkipChange={setSkipRowsWithErrors}
      onFileChosen={onFileChosen}
      onMappingChange={(field, header) => {
        // Correcting a column re-runs the SERVER's reading of the file, never a
        // second client-side interpretation of it -- the preview and the commit
        // must be the same parse.
        const next = { ...mapping, [field]: header };
        setMapping(next);
        if (file) void runDryRun(file, next);
      }}
      onImport={onImport}
      onRetry={() => (raw ? onImport() : file && onFileChosen(file))}
      extraSummary={raw ? `${raw.willImport} of ${raw.totalParsed} rows will import` : undefined}
      extraControls={
        <fieldset className="space-y-2 text-[12.5px]">
          <legend className="text-px-muted">Create as</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="import-target" value="rev0" checked={target === "rev0"} onChange={() => setTarget("rev0")} />
            Create as Rev0
          </label>
          {boqs.map((b) => (
            <label key={b.id} className="flex items-center gap-2">
              <input type="radio" name="import-target" value={b.id} checked={target === b.id} onChange={() => setTarget(b.id)} />
              Create as new revision of {b.title} (v{b.version})
            </label>
          ))}
        </fieldset>
      }
    />
  );
}
