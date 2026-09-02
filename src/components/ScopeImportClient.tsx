"use client";

// R67 lane D22 (item D-52, rec R-176) -- THE BOQ EXCEL IMPORT SCREEN.
//
// The importer itself has been shipped end to end for a while
// (construction-boq-import-service.parseBoqSpreadsheet, POST
// /api/v1/projexa/scope/import, this repo's own /api/scope/import proxy) and
// has never had a screen, so the only way to use it was a curl command. This
// is only the screen.
//
// NO XLSX LIBRARY IS ADDED HERE, and none may be: the file is posted as
// FormData and parsed server-side, and the preview below is VERIDIAN's real
// reading of it (dryRun=true), not a second client-side parse that could
// disagree with what actually gets committed.
//
// Three steps, because they are three different questions: which file, which
// columns, and is this right. Each one can be answered and reversed before
// anything is written.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Table as TableIcon, Upload } from "lucide-react";
import { useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { withMoney } from "@/lib/money";
import { setFooterMessage } from "@/lib/footer-message";
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
const REQUIRED_FIELDS = [
  { key: "itemCode", label: "Code" },
  { key: "description", label: "Description" },
  { key: "quantity", label: "Qty" },
  { key: "unit", label: "Unit" },
  { key: "rate", label: "Rate" },
] as const;

const OPTIONAL_FIELDS = [
  { key: "amount", label: "Amount" },
  { key: "parentItemCode", label: "Parent code" },
  { key: "breakdownPercentage", label: "Breakdown %" },
  { key: "subTask", label: "Sub task" },
] as const;

const UNMAPPED = "__unmapped__";

type Step = "choose" | "map" | "preview";

export default function ScopeImportClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  const [step, setStep] = useState<Step>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DryRunResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [target, setTarget] = useState<string>("rev0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (mappingOverride) {
        // "__unmapped__" is the UI's way of saying "this field has no column";
        // the server reads an empty string as that, so translate rather than
        // sending an internal sentinel over the wire.
        body.append("mapping", JSON.stringify(
          Object.fromEntries(Object.entries(mappingOverride).map(([k, v]) => [k, v === UNMAPPED ? "" : v]))
        ));
      }
      const res = await fetch("/api/scope/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't read this file");
      const parsed = data as DryRunResponse;
      setPreview(parsed);
      if (!mappingOverride) {
        setMapping(Object.fromEntries(
          [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((f) => [f.key, parsed.mapping[f.key] ?? UNMAPPED])
        ));
      }
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
    setPreview(null);
    if (!chosen) return;
    const parsed = await runDryRun(chosen);
    if (parsed) setStep("map");
  }

  const unmappedRequired = useMemo(
    () => REQUIRED_FIELDS.filter((f) => !mapping[f.key] || mapping[f.key] === UNMAPPED),
    [mapping]
  );

  async function onNextFromMapping() {
    if (!file) return;
    const parsed = await runDryRun(file, mapping);
    if (parsed) setStep("preview");
  }

  async function onImport() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("projectId", projectId);
      body.append("mapping", JSON.stringify(
        Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v === UNMAPPED ? "" : v]))
      ));
      if (target !== "rev0") body.append("parentBoqId", target);
      const res = await fetch("/api/scope/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Stays on Preview. The importer commits in one transaction, so a
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

  const importDisabledReason = !file
    ? "Choose a file"
    : busy
      ? "Importing…"
      : unmappedRequired.length > 0
        ? `Fix ${unmappedRequired.length} unmapped required ${unmappedRequired.length === 1 ? "field" : "fields"}`
        : null;

  return (
    <div className="space-y-4">
      <ol className="flex gap-6 text-[12.5px]">
        {(["choose", "map", "preview"] as Step[]).map((s, i) => (
          <li key={s} className={s === step ? "font-medium text-px-ink" : "text-px-muted"}>
            {i + 1}. {s === "choose" ? "Choose file" : s === "map" ? "Map columns" : "Preview"}
          </li>
        ))}
      </ol>

      {error && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p role="alert" className="text-sm text-px-error">{error}</p>
            <Button variant="outline" size="sm" onClick={() => (step === "preview" ? onImport() : file && onFileChosen(file))}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {step === "choose" && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-px-muted">One row per BOQ line. Sub-items use Parent code and Breakdown %.</p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-px-border2 p-8 text-center">
              <Upload className="size-6 text-px-muted" aria-hidden="true" />
              <span className="text-sm font-medium">Choose a .xlsx or .csv file</span>
              <span className="text-[12px] text-px-muted">{busy ? "Reading…" : "or drop it here"}</span>
              <input
                type="file" accept=".xlsx,.xls,.csv" className="sr-only"
                aria-label="BOQ spreadsheet"
                onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-[12.5px]">
              <a className="text-px-steel underline underline-offset-2" href="/templates/boq-import-template.csv" download>
                Download template
              </a>
              <span className="text-px-muted"> — S.No | Category | Code | Description | Qty | Unit | Rate | Amount | Parent code | Breakdown %</span>
            </p>
          </CardContent>
        </Card>
      )}

      {step === "map" && preview && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-px-muted">
              Columns detected in <span className="font-medium">{preview.fileName}</span>. Change any that point at the wrong column.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((f) => {
                const required = REQUIRED_FIELDS.some((r) => r.key === f.key);
                const value = mapping[f.key] ?? UNMAPPED;
                return (
                  <label key={f.key} className="space-y-1 text-[12.5px]">
                    <span className={required && value === UNMAPPED ? "text-px-error" : "text-px-muted"}>
                      {f.label}{required && <span aria-hidden="true"> *</span>}
                      {required && <span className="sr-only"> (required)</span>}
                    </span>
                    <Select value={value} onValueChange={(v) => setMapping((prev) => ({ ...prev, [f.key]: v }))}>
                      <SelectTrigger aria-label={`${f.label} column`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNMAPPED}>Not in this file</SelectItem>
                        {preview.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={onNextFromMapping}
                disabled={busy || unmappedRequired.length > 0}
                title={unmappedRequired.length > 0 ? `${unmappedRequired.length} required fields unmapped - ${unmappedRequired.map((f) => f.label).join(", ")}` : undefined}
              >
                Next
              </Button>
              {unmappedRequired.length > 0 && (
                <p role="status" className="text-[12.5px] text-px-error">
                  {unmappedRequired.length} required {unmappedRequired.length === 1 ? "field" : "fields"} unmapped - {unmappedRequired.map((f) => f.label).join(", ")}
                </p>
              )}
              <Button variant="ghost" onClick={() => setStep("choose")}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "preview" && preview && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm">
              <span className="font-medium">{preview.willImport} of {preview.totalParsed} rows will import</span>
              {preview.rows.length < preview.totalParsed && (
                <span className="text-px-muted"> — showing the first {preview.rows.length}</span>
              )}
            </p>

            {preview.warnings.length > 0 && (
              <ul className="space-y-1 text-[12.5px] text-px-warning">
                {preview.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

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

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-right">S.No</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.index}>
                      <TableCell className="text-right text-px-muted">{row.index}</TableCell>
                      <TableCell className="text-px-muted">{row.category ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[11px]">{row.itemCode ?? "—"}</TableCell>
                      <TableCell className={row.parentItemCode ? "pl-6 text-px-muted" : ""}>{row.description}</TableCell>
                      <TableCell className="text-right">{row.quantity}</TableCell>
                      <TableCell className="text-px-muted">{row.unit || "—"}</TableCell>
                      <TableCell className="text-right">{withMoney(currencyCode, row.rate)}</TableCell>
                      <TableCell className="text-right">{withMoney(currencyCode, row.amount)}</TableCell>
                      <TableCell className={row.status === "warning" ? "text-px-warning" : "text-px-success"}>
                        {row.status === "warning" ? row.messages.join("; ") : "OK"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={onImport} disabled={!!importDisabledReason} title={importDisabledReason ?? undefined}>
                <TableIcon className="size-4" aria-hidden="true" />
                Import ({preview.willImport} rows)
              </Button>
              {importDisabledReason && <p className="text-[12.5px] text-px-muted">{importDisabledReason}</p>}
              <Button variant="ghost" onClick={() => setStep("map")}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
