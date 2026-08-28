"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, GitCompare, GitBranchPlus, Eye } from "lucide-react";
import { useCurrencies } from "@/lib/currency";
import { CompareScreen, type ScreenColumn, type CompareResult, type CompareChangedRow } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

// R44 seq3 (M28 registry-model proof, same pattern as PermitsListClient's
// RegistryColumn): intentionally the same fields as ScreenColumn so a
// registry row (compliance.screen_definitions, function_id "boq.compare")
// can be passed straight in with no reshaping.
export type RegistryColumn = ScreenColumn;

// Fallback when no registry row is seeded yet (or the resolve call errors) --
// mirrors the registry seed 1:1, so there is no visible difference between
// "resolved from the DB" and "resolved from this hardcoded default" (M28: keep
// the hardcoded version behind a flag until verified).
const DEFAULT_COMPARE_COLUMNS: ScreenColumn[] = [
  { field: "description", label: "Description", type: "text", importance: "High" },
  { field: "unit", label: "Unit", type: "text", importance: "High" },
  { field: "quantity", label: "Qty", type: "number", importance: "High" },
  { field: "rate", label: "Rate", type: "number", importance: "High" },
  { field: "amount", label: "Amount", type: "number", importance: "High" },
];

// R46 P8 seq121 (M28 registry-model, CUSTOM archetype -- function_id
// "boq.custom"): the main BOQ table below stays a fully hand-rolled <Table>
// (not the kit's generic ListScreen -- revisions/variation/hierarchy don't
// fit a plain LIST renderer), but its column LABELS are now registry-driven
// the same way every other converted screen's are. Only label text reads
// from the registry row; the "Actions" column has no backing field and
// always stays hardcoded. Mirrors DEFAULT_COMPARE_COLUMNS 1:1 so there is no
// visible difference between "resolved from the DB" and this fallback.
const DEFAULT_LIST_COLUMNS: ScreenColumn[] = [
  { field: "title", label: "Title", type: "text", importance: "High" },
  { field: "version", label: "Version", type: "text", importance: "High" },
  { field: "status", label: "Status", type: "text", importance: "High" },
  { field: "variation", label: "Variation vs. prior", type: "text", importance: "High" },
  { field: "createdAt", label: "Created", type: "date", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

// Reshapes VERIDIAN's BoqComparison (added/removed/changed + a flat
// netVariation per changed row) into CompareScreen's generic CompareResult
// (changedFields drives which cells highlight) -- CompareScreen itself knows
// nothing about BOQs, quantity, or rate.
function toCompareResult(cmp: BoqComparison): CompareResult {
  const changed: CompareChangedRow[] = cmp.changed.map((c) => {
    const changedFields: string[] = [];
    if (c.quantityChange !== 0) changedFields.push("quantity");
    if (c.rateChange !== 0) changedFields.push("rate");
    if (c.quantityChange !== 0 || c.rateChange !== 0) changedFields.push("amount");
    return { key: c.key, previous: c.previous, current: c.current, changedFields };
  });
  return { added: cmp.added, removed: cmp.removed, changed, warnings: cmp.warnings };
}

type Boq = {
  id: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
};

type LineItemDraft = { description: string; unit: string; quantity: string; rate: string; itemCode?: string; activityId?: string; parentItemCode?: string; breakdownPercentage?: string };

type BoqLineItemRow = {
  id: string; itemCode: string | null; description: string; unit: string;
  quantity: string; rate: string; amount: string; activityId: string | null;
  parentLineItemId?: string | null; breakdownPercentage?: string | null;
  // R39/R-C09: Point 154's budget overlay -- computedBudget is derived
  // server-side (amount * budgetPercentage / 100, construction-boq-
  // service.ts#computedBudget), never sent back independently editable.
  budgetPercentage?: string | null;
  computedBudget?: number | null;
  vendorId?: string | null;
  vendorAmount?: string | null;
};

type Vendor = { id: string; vendorName: string };

type ChangedLineItem = {
  key: string; previous: BoqLineItemRow; current: BoqLineItemRow;
  quantityChange: number; rateChange: number; netVariation: number;
};

type BoqComparison = {
  added: BoqLineItemRow[]; removed: BoqLineItemRow[]; changed: ChangedLineItem[];
  warnings: string[]; totalVariation: number;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", submitted: "default", approved: "outline", superseded: "destructive",
};

const emptyLine = (): LineItemDraft => ({ description: "", unit: "", quantity: "", rate: "", itemCode: "", parentItemCode: "", breakdownPercentage: "" });

function toDrafts(rows: BoqLineItemRow[]): LineItemDraft[] {
  // Every row needs a resolvable itemCode: the API re-links a sub-task to its
  // parent by matching parentItemCode to an itemCode in the SAME submission,
  // and itemCode is nullable in the database. Synthesise one where it is
  // missing, or a sub-task silently becomes top-level on revision and the
  // total re-inflates.
  const codeById = new Map<string, string>();
  const taken = new Set(rows.map((r) => r.itemCode?.trim()).filter((c): c is string => Boolean(c)));
  for (const r of rows) {
    const existing = r.itemCode?.trim();
    if (existing) { codeById.set(r.id, existing); continue; }
    let synth = `_row_${r.id}`;
    while (taken.has(synth)) synth = `${synth}_x`;
    taken.add(synth);
    codeById.set(r.id, synth);
  }
  return rows.map((row) => ({
    description: row.description,
    unit: row.unit,
    quantity: String(row.quantity),
    rate: String(row.rate),
    itemCode: codeById.get(row.id),
    activityId: row.activityId ?? undefined,
    parentItemCode: row.parentLineItemId ? codeById.get(row.parentLineItemId) : undefined,
    breakdownPercentage: row.breakdownPercentage != null ? String(row.breakdownPercentage) : undefined,
  }));
}

function formatVariation(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatAmount(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value ?? "");
}

// Deliberately NOT currencyLabel() from the shared helper: that returns a
// hardcoded rupee symbol when no base currency is found, which would be wrong
// on a UAE contractor's BOQ. Here an unresolved currency degrades to the bare
// number instead - no label is survivable, the wrong label is not.
function withCurrency(code: string, value: string | number | null | undefined): string {
  const n = formatAmount(value);
  return code ? `${code} ${n}` : n;
}

// Point 104: reverses PR #81's blanking of sub-task Qty/Rate. His sheet puts
// the weighting in the RATE alone -- Qty is the parent's, unweighted; Rate
// is parent rate x breakdownPercentage / 100. Never weight the quantity too
// -- that would square the percentage. Display-only: nothing is stored, and
// a sub-task with no breakdownPercentage has no derivable rate at all (still
// dashes -- inventing one would be worse than blanking).
// Point 105: a live running total of child breakdownPercentage values,
// grouped by parentItemCode, over the DRAFT rows in the create/revise form
// (not the database -- these are unsaved, still being typed). Display only,
// recomputed at render on every keystroke, never persisted. MUST NOT warn,
// block, or auto-normalise a non-100 total -- his items 1.04/4.02 legitimately
// sum to 75/65 and that is a deliberate scope statement, not an error. A
// parent with no children (nothing references its itemCode) shows nothing.
function childPercentSum(lines: LineItemDraft[], parentItemCode?: string): number | null {
  const code = parentItemCode?.trim();
  if (!code) return null;
  const children = lines.filter((l) => l.parentItemCode?.trim() === code);
  if (children.length === 0) return null;
  return children.reduce((sum, l) => sum + (Number(l.breakdownPercentage) || 0), 0);
}

function derivedSubQtyRate(row: BoqLineItemRow, allRows: BoqLineItemRow[]): { qty: number; rate: number } | null {
  if (row.breakdownPercentage == null) return null;
  const parent = allRows.find((p) => p.id === row.parentLineItemId);
  if (!parent) return null;
  const pct = Number(row.breakdownPercentage);
  const parentQty = Number(parent.quantity);
  const parentRate = Number(parent.rate);
  if (!Number.isFinite(pct) || !Number.isFinite(parentQty) || !Number.isFinite(parentRate)) return null;
  return { qty: parentQty, rate: (parentRate * pct) / 100 };
}

// A weighted sub-task's amount is DERIVED from its parent (parent qty x parent
// rate x breakdown %), so it is already contained in the parent's amount.
// Summing every row flat double-counts the BOQ. Top-level rows only.
function boqTotal(rows: BoqLineItemRow[]): number {
  return rows
    .filter((r) => !r.parentLineItemId)
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
}

// R47-003 (fault R47_SILENT_DROP_01, reproduced live 2026-08-25): both the
// create and revise paths used to filter incomplete rows out with
// `lines.filter(...)` and then submit the survivors. A row the user had
// genuinely typed into but not finished was DISCARDED WITH NO WARNING and the
// ordinary green success toast still appeared -- silent data loss on a write
// path, reported as success.
//
// Reproduced: a TC-10 BOQ (parent M1 + children M1-A/40, M1-B/35, M1-C/25)
// submitted with M1-B's Unit blank sent only ["M1","M1-A","M1-C"], persisted 3
// rows, and said "BOQ created". The worse second-order effect is that the
// surviving weights then total 65 instead of 100, so every earned-value and
// percent-complete figure derived from that BOQ is quietly wrong.
//
// The distinction that matters is UNTOUCHED vs INCOMPLETE. The form always
// renders a trailing empty row, so a wholly blank row must stay ignorable --
// otherwise every submit would fail. A row with ANY content in it, though, is
// something a human meant, and dropping it is never the right answer.
// Returns the rows to submit, or a message naming the offending row.
function collectLines(lines: LineItemDraft[]): { valid: LineItemDraft[]; error: string | null } {
  const val = (s: string | undefined) => (s ?? "").trim();
  const isUntouched = (l: LineItemDraft) =>
    !val(l.description) && !val(l.unit) && !val(l.quantity) && !val(l.rate) &&
    !val(l.itemCode) && !val(l.parentItemCode) && !val(l.breakdownPercentage);

  // A sub-task inherits its unit from the parent it prices off. Requiring the
  // user to retype it is friction with no meaning -- and it was the single most
  // likely field to be left blank on a child row, which used to cost the whole
  // submit. Inherited here, from the parent in the SAME submission, so the row
  // still reaches the server with a unit and cannot come back as a NOT NULL
  // violation.
  const unitFor = (l: LineItemDraft): string => {
    const own = val(l.unit);
    if (own) return own;
    const parentCode = val(l.parentItemCode);
    if (!parentCode) return "";
    const parent = lines.find((p) => val(p.itemCode) === parentCode);
    return parent ? val(parent.unit) : "";
  };

  const missingFrom = (l: LineItemDraft): string[] => {
    const missing: string[] = [];
    if (!val(l.description)) missing.push("Description");
    // Checked against the INHERITED unit, so a child with a blank Unit whose
    // parent has one is complete rather than rejected.
    if (!unitFor(l)) missing.push("Unit");
    if (val(l.parentItemCode)) {
      // A sub-task prices off its parent, so it needs no Qty/Rate of its own --
      // but VERIDIAN rejects a child with no breakdown % (construction-boq-
      // service.ts deriveLineItemQuantityAndRate), so catch that here with a
      // field name instead of letting it come back as a generic 400.
      if (!val(l.breakdownPercentage)) missing.push("Breakdown %");
    } else {
      if (!val(l.quantity)) missing.push("Qty");
      if (!val(l.rate)) missing.push("Rate");
    }
    return missing;
  };

  const valid: LineItemDraft[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isUntouched(lines[i])) continue;
    const missing = missingFrom(lines[i]);
    if (missing.length > 0) {
      return { valid: [], error: `Line ${i + 1} is incomplete — add ${missing.join(", ")}. Nothing was saved.` };
    }
    // Push the row WITH its resolved unit, so what the server receives matches
    // what the form accepted. Validating against an inherited value and then
    // sending a blank one would be its own quiet lie.
    valid.push({ ...lines[i], unit: unitFor(lines[i]) });
  }
  if (valid.length === 0) return { valid: [], error: "Add at least one complete line item" };
  return { valid, error: null };
}

// R46M13_TC10_01 (reproduced 3x live, 2026-08-25, parent + 3 weighted
// children): the "New BOQ" dialog reported "BOQ created" for a create that
// persisted NOTHING -- server-verified, no row at all in
// compliance.construction_boqs for any of the three attempts.
//
// Two things made a non-write indistinguishable from a write.
// First, `res.json().catch(() => ({}))` swallowed an unparseable body
// outright and fell through on an empty object, so a 2xx that carried no
// JSON at all still reached the success toast. Keep the two failure modes
// apart: a response that will not parse is itself a failed create, never
// something to continue past.
// Second, success was declared from `res.ok` ALONE: nothing ever checked
// that a BOQ actually came back. Never report a write we have not seen
// return. /api/scope only sends 201 once the scope service has echoed a
// real row id and the line items read back after insert -- re-check both
// here too, so a drift on either side of that contract fails loudly instead
// of quietly reverting to "trust the status code". The weighted-children
// shape is exactly the one that regressed, so the count check is what
// protects it.
//
// Extracted to a pure function (exported) so it can be regression-tested
// directly: this repo's happy-dom + React 19 test environment cannot
// reliably fire a text-input change event through the full "New BOQ" form
// (no @testing-library/user-event installed), so exercising this contract
// through fireEvent-typed form fields is not currently reliable here --
// unit-testing the extracted contract is.
export function confirmBoqCreated(
  ok: boolean,
  data: { id?: unknown; lineItems?: unknown; error?: unknown } | null,
  parseFailed: boolean,
  submittedCount: number
): string {
  if (!ok) throw new Error((typeof data?.error === "string" && data.error) || "Couldn't create BOQ");
  if (parseFailed || !data) throw new Error("Couldn't create BOQ — the server's response was unreadable, so nothing is confirmed saved.");

  const savedId = typeof data.id === "string" ? data.id.trim() : "";
  if (!savedId) throw new Error("Couldn't create BOQ — the server did not confirm a saved BOQ. Nothing was saved.");
  const savedLineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
  if (savedLineItems < submittedCount) {
    throw new Error(`Couldn't create BOQ — ${submittedCount} line item(s) were submitted but only ${savedLineItems} came back saved.`);
  }
  return savedId;
}

export default function ScopeClient({ projectId, compareColumns, listColumns }: { projectId: string; compareColumns?: RegistryColumn[] | null; listColumns?: RegistryColumn[] | null }) {
  const columns = compareColumns && compareColumns.length > 0 ? compareColumns : DEFAULT_COMPARE_COLUMNS;
  const boqListColumns = listColumns && listColumns.length > 0 ? listColumns : DEFAULT_LIST_COLUMNS;
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  // Variation vs. immediate parent, per revision -- the "running total
  // variation value" the Owner asked for, fetched from VERIDIAN's compareBoq
  // rather than stored (this codebase computes diffs at read time, never
  // denormalizes them).
  const [variationByBoqId, setVariationByBoqId] = useState<Record<string, number>>({});

  const [revising, setRevising] = useState<Boq | null>(null);
  const [revisionLines, setRevisionLines] = useState<LineItemDraft[]>([]);
  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const [revisionBlock, setRevisionBlock] = useState<string | null>(null);

  const [comparing, setComparing] = useState<Boq | null>(null);
  const [comparison, setComparison] = useState<BoqComparison | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [compareAgainst, setCompareAgainst] = useState<string>("");

  const [viewing, setViewing] = useState<Boq | null>(null);
  const [viewRows, setViewRows] = useState<BoqLineItemRow[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  // R39/R-C09: budget/vendor overlay on the View dialog -- vendors fetched
  // once per dialog open (same /api/vendors list point 32's Company field
  // already uses), savingRowId disables just the one row being PATCHed.
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      const loaded: Boq[] = data.boqs ?? [];
      setBoqs(loaded);

      const revisions = loaded.filter((b) => b.parentBoqId);
      const entries = await Promise.all(
        revisions.map(async (b) => {
          const cmpRes = await fetch(`/api/scope/${b.id}/compare`);
          if (!cmpRes.ok) return null;
          const cmp: BoqComparison = await cmpRes.json();
          return [b.id, cmp.totalVariation] as const;
        })
      );
      setVariationByBoqId(Object.fromEntries(entries.filter((e): e is readonly [string, number] => e !== null)));
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load scope of work");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function createBoq() {
    if (!title.trim()) return;
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      toast.error(lineError);
      return;
    }
    const payloadLineItems = validLines.map((l) => ({
      description: l.description,
      unit: l.unit,
      quantity: Number(l.quantity),
      rate: Number(l.rate),
      ...(l.itemCode?.trim() ? { itemCode: l.itemCode.trim() } : {}),
      ...(l.parentItemCode?.trim() ? { parentItemCode: l.parentItemCode.trim() } : {}),
      ...(l.breakdownPercentage?.trim() ? { breakdownPercentage: Number(l.breakdownPercentage) } : {}),
    }));
    setSubmitting(true);
    try {
      const res = await fetch("/api/scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, lineItems: payloadLineItems }),
      });

      // See confirmBoqCreated() above (R46M13_TC10_01) for why a 2xx alone
      // is never enough to declare success.
      let data: { id?: unknown; lineItems?: unknown; error?: unknown } | null = null;
      let parseFailed = false;
      try {
        data = await res.json();
      } catch {
        parseFailed = true;
      }

      confirmBoqCreated(res.ok, data, parseFailed, payloadLineItems.length);

      toast.success("BOQ created");
      setTitle(""); setLines([emptyLine()]); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create BOQ");
    } finally {
      setSubmitting(false);
    }
  }

  async function openRevisionDialog(boq: Boq) {
    setRevising(boq);
    setRevisionTitle(boq.title);
    setRevisionBlock(null);
    try {
      const data = await fetchJson(`/api/scope/${boq.id}`);
      const rows: BoqLineItemRow[] = data.lineItems ?? [];
      setRevisionLines(rows.length > 0 ? toDrafts(rows) : [emptyLine()]);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load the current scope to revise"));
      setRevisionLines([emptyLine()]);
    }
  }

  function updateRevisionLine(index: number, field: keyof LineItemDraft, value: string) {
    setRevisionLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function submitRevision(allowScopeReductionOverride = false) {
    if (!revising) return;
    const { valid: validLines, error: lineError } = collectLines(revisionLines);
    if (lineError) {
      toast.error(lineError);
      return;
    }
    setRevisionSubmitting(true);
    setRevisionBlock(null);
    try {
      const res = await fetch(`/api/scope/${revising.id}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: revisionTitle,
          lineItems: validLines.map((l) => ({
            description: l.description, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate),
            ...(l.itemCode?.trim() ? { itemCode: l.itemCode.trim() } : {}), ...(l.activityId ? { activityId: l.activityId } : {}),
            ...(l.parentItemCode?.trim() ? { parentItemCode: l.parentItemCode.trim() } : {}),
            ...(l.breakdownPercentage?.trim() ? { breakdownPercentage: Number(l.breakdownPercentage) } : {}),
          })),
          allowScopeReductionOverride,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Owner's hard-block rule: this revision would reduce/remove scope
        // already completed on site. Surface the real reason and let the
        // user explicitly override instead of silently failing or silently
        // applying it.
        setRevisionBlock(data.error ?? "This revision reduces scope already completed on site.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to create revision");
      toast.success(allowScopeReductionOverride ? "Revision created (override applied)" : "Revision created");
      setRevising(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create revision");
    } finally {
      setRevisionSubmitting(false);
    }
  }

  async function openViewDialog(boq: Boq) {
    setViewing(boq);
    setViewRows([]);
    setViewLoading(true);
    try {
      const [boqRes, vendorsRes] = await Promise.all([
        fetch(`/api/scope/${boq.id}`),
        vendors.length === 0 ? fetch("/api/vendors") : Promise.resolve(null),
      ]);
      const data = await boqRes.json();
      if (!boqRes.ok) throw new Error(data.error ?? "Couldn't load this BOQ");
      setViewRows(data.lineItems ?? []);
      if (vendorsRes) {
        const vendorData = await vendorsRes.json();
        if (vendorsRes.ok) setVendors(vendorData.vendors ?? []);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load this BOQ");
      setViewing(null);
    } finally {
      setViewLoading(false);
    }
  }

  // R39/R-C09: PATCHes one row's budget/vendor overlay, then re-fetches
  // that row's fresh computedBudget from the server (never computed here --
  // computedBudget() is the ONE place this arithmetic lives, D-3) so a
  // budgetPercentage override is reflected immediately without a full
  // dialog reload.
  async function saveLineItemBudget(rowId: string, patch: { budgetPercentage?: number; vendorId?: string | null; vendorAmount?: number | null }) {
    setSavingRowId(rowId);
    try {
      const res = await fetch(`/api/scope/line-items/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setViewRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...data } : r)));
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save budget/vendor");
    } finally {
      setSavingRowId(null);
    }
  }

  // Point 106: the comparison engine (compareBoq) already accepts any
  // in-project `against` BOQ id -- the gap was exposure only. Rajat ruled:
  // default to the ORIGINAL (the revision whose parentBoqId is null), not
  // the immediate parent -- "compared to original scope, Rev 1, Rev 2", and
  // a variation claim is made against the contract, not against last week.
  // Walk parentBoqId to null rather than assume it's the lowest version
  // number. A baseline BOQ has no parent, so its own "original" is itself --
  // comparing it against itself correctly yields an empty diff (a legitimate
  // answer, not a hidden control -- see the Compare button below).
  function findOriginalBoqId(boq: Boq): string {
    let current = boq;
    while (current.parentBoqId) {
      const parent = boqs.find((b) => b.id === current.parentBoqId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  }

  async function loadComparison(boq: Boq, against: string) {
    setComparisonLoading(true);
    try {
      const res = await fetch(`/api/scope/${boq.id}/compare?against=${encodeURIComponent(against)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to compare revisions");
      setComparison(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't compare revisions");
      setComparing(null);
    } finally {
      setComparisonLoading(false);
    }
  }

  async function openCompareDialog(boq: Boq) {
    setComparing(boq);
    setComparison(null);
    const original = findOriginalBoqId(boq);
    setCompareAgainst(original);
    await loadComparison(boq, original);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New BOQ</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Bill of Quantities</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Civil Works - Phase 1" /></div>
              <div className="space-y-2">
                <Label>Line Items</Label>
                {lines.map((line, i) => {
                  const childSum = childPercentSum(lines, line.itemCode);
                  return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input className="min-w-[180px] flex-1" placeholder="Description" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                    <Input className="w-[80px] shrink-0" placeholder="Unit" value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                    <Input className="w-[90px] shrink-0" placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                    <Input className="w-[90px] shrink-0" placeholder="Rate" type="number" value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                    <Input className="w-[110px] shrink-0" placeholder="Item Code" value={line.itemCode ?? ""} onChange={(e) => updateLine(i, "itemCode", e.target.value)} />
                    <Input className="w-[130px] shrink-0" placeholder="Parent Item Code" value={line.parentItemCode ?? ""} onChange={(e) => updateLine(i, "parentItemCode", e.target.value)} />
                    <Input className="w-[110px] shrink-0" placeholder="Breakdown %" type="number" value={line.breakdownPercentage ?? ""} onChange={(e) => updateLine(i, "breakdownPercentage", e.target.value)} />
                    {childSum != null && <span className="text-xs text-px-muted">{childSum}% total</span>}
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                  <Plus className="size-3.5" /> Add Line
                </Button>
              </div>
            </div>
            <DialogFooter><Button onClick={createBoq} disabled={submitting}>{submitting ? "Creating…" : "Create BOQ"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : boqs.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No BOQs yet for this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{columnLabel(boqListColumns, "title", "Title")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "version", "Version")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "status", "Status")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "variation", "Variation vs. prior")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "createdAt", "Created")}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boqs.map((b) => {
                  const variation = variationByBoqId[b.id];
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-px-muted">v{b.version}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                      <TableCell>
                        {!b.parentBoqId ? (
                          <span className="text-px-muted">Baseline (Rev0)</span>
                        ) : variation === undefined ? (
                          <span className="text-px-muted">—</span>
                        ) : (
                          <span className={variation > 0 ? "text-px-success" : variation < 0 ? "text-px-error" : "text-px-muted"}>{currencyCode ? `${currencyCode} ` : ""}{formatVariation(variation)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-px-muted">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => openViewDialog(b)}><Eye className="size-3.5" /> View</Button>
                        <Button variant="ghost" size="sm" onClick={() => openCompareDialog(b)}><GitCompare className="size-3.5" /> Compare</Button>
                        <Button variant="ghost" size="sm" onClick={() => openRevisionDialog(b)}><GitBranchPlus className="size-3.5" /> New Revision</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.title} (v{viewing?.version})</DialogTitle></DialogHeader>
          {viewLoading ? (
            <div className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : viewRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-px-muted">This BOQ has no line items.</p>
          ) : (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Code</TableHead><TableHead>Description</TableHead><TableHead>Unit</TableHead>
                    <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewRows.map((r) => {
                    const isSub = Boolean(r.parentLineItemId);
                    const derived = isSub ? derivedSubQtyRate(r, viewRows) : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className={isSub ? "pl-8 text-px-muted" : "font-medium"}>{r.itemCode ?? "—"}</TableCell>
                        <TableCell className={isSub ? "pl-4" : ""}>
                          {r.description}
                          {isSub && r.breakdownPercentage != null && (
                            <span className="ml-2 text-xs text-px-muted">{r.breakdownPercentage}% of parent</span>
                          )}
                        </TableCell>
                        <TableCell className="text-px-muted">{r.unit}</TableCell>
                        {/* R46 seq110 (T-BOQ-02-2): muted styling is DERIVED-figure signaling,
                            not a row-level "this is a sub-task" indicator -- parent Qty/Rate are
                            directly entered and must render un-muted so users can tell a computed
                            sub-task figure apart from one someone actually typed in. */}
                        <TableCell className={isSub ? "text-right text-px-muted" : "text-right"} title={isSub ? "Qty derived from parent line item" : undefined}>{!isSub ? formatAmount(r.quantity) : derived ? formatAmount(derived.qty) : "—"}</TableCell>
                        <TableCell className={isSub ? "text-right text-px-muted" : "text-right"} title={isSub ? "Rate derived from parent rate × breakdown %" : undefined}>{!isSub ? withCurrency(currencyCode, r.rate) : derived ? withCurrency(currencyCode, derived.rate) : "—"}</TableCell>
                        <TableCell className="text-right">{withCurrency(currencyCode, r.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex justify-end border-t pt-3 text-sm">
                <span className="text-px-muted">Total</span>
                <span className="ml-4 font-medium">{withCurrency(currencyCode, boqTotal(viewRows))}</span>
              </div>

              {/* R39/R-C09: Budget & Vendor overlay -- Point 154's budget_percentage
                  (default 25%, editable per line) x amount = budget (server-computed,
                  never derived here -- see computedBudget() in construction-boq-
                  service.ts). Entering a vendor + vendor amount computes variance =
                  vendorAmount - budget live. */}
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Budget &amp; Vendor</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Budget %</TableHead>
                      <TableHead className="text-right">Budget</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Vendor Amount</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewRows.map((r) => {
                      const budget = r.computedBudget ?? (Number(r.amount) * (Number(r.budgetPercentage ?? 25) / 100));
                      const vendorAmount = r.vendorAmount !== null && r.vendorAmount !== undefined ? Number(r.vendorAmount) : null;
                      const variance = vendorAmount !== null ? vendorAmount - budget : null;
                      const saving = savingRowId === r.id;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="max-w-[160px] truncate">{r.itemCode ?? r.description}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" disabled={saving} className="w-20 text-right"
                              defaultValue={r.budgetPercentage ?? "25"}
                              onBlur={(e) => {
                                const pct = Number(e.target.value);
                                if (!Number.isFinite(pct) || String(pct) === (r.budgetPercentage ?? "25")) return;
                                saveLineItemBudget(r.id, { budgetPercentage: pct });
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-right text-px-muted">{withCurrency(currencyCode, budget)}</TableCell>
                          <TableCell>
                            <Select
                              disabled={saving}
                              value={r.vendorId ?? undefined}
                              onValueChange={(vendorId) => saveLineItemBudget(r.id, { vendorId })}
                            >
                              <SelectTrigger className="w-[160px]"><SelectValue placeholder="No vendor" /></SelectTrigger>
                              <SelectContent>
                                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" disabled={saving} className="w-24 text-right"
                              defaultValue={r.vendorAmount ?? ""}
                              placeholder="—"
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const amt = raw === "" ? null : Number(raw);
                                if (raw !== "" && !Number.isFinite(amt)) return;
                                saveLineItemBudget(r.id, { vendorAmount: amt });
                              }}
                            />
                          </TableCell>
                          <TableCell className={`text-right ${variance !== null && variance > 0 ? "text-px-error" : ""}`}>
                            {variance === null ? <span className="text-px-muted">—</span> : withCurrency(currencyCode, variance)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!revising} onOpenChange={(o) => !o && setRevising(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Revision -- from &quot;{revising?.title}&quot; (v{revising?.version})</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Revision Title</Label><Input value={revisionTitle} onChange={(e) => setRevisionTitle(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Line Items</Label>
              {revisionLines.map((line, i) => {
                const childSum = childPercentSum(revisionLines, line.itemCode);
                return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input className="min-w-[180px] flex-1" placeholder="Description" value={line.description} onChange={(e) => updateRevisionLine(i, "description", e.target.value)} />
                  <Input className="w-[80px] shrink-0" placeholder="Unit" value={line.unit} onChange={(e) => updateRevisionLine(i, "unit", e.target.value)} />
                  <Input className="w-[90px] shrink-0" placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateRevisionLine(i, "quantity", e.target.value)} />
                  <Input className="w-[90px] shrink-0" placeholder="Rate" type="number" value={line.rate} onChange={(e) => updateRevisionLine(i, "rate", e.target.value)} />
                  <Input className="w-[110px] shrink-0" placeholder="Item Code" value={line.itemCode ?? ""} onChange={(e) => updateRevisionLine(i, "itemCode", e.target.value)} />
                  <Input className="w-[130px] shrink-0" placeholder="Parent Item Code" value={line.parentItemCode ?? ""} onChange={(e) => updateRevisionLine(i, "parentItemCode", e.target.value)} />
                  <Input className="w-[110px] shrink-0" placeholder="Breakdown %" type="number" value={line.breakdownPercentage ?? ""} onChange={(e) => updateRevisionLine(i, "breakdownPercentage", e.target.value)} />
                  {childSum != null && <span className="text-xs text-px-muted">{childSum}% total</span>}
                  <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setRevisionLines((prev) => prev.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => setRevisionLines((prev) => [...prev, emptyLine()])}>
                <Plus className="size-3.5" /> Add Line
              </Button>
              <p className="text-xs text-px-muted">Removing a line, or reducing its quantity/rate, is blocked if that item is already recorded as complete on site.</p>
            </div>
            {revisionBlock && (
              <Card className="border-px-error-border bg-px-error-light">
                <CardContent className="space-y-2 p-3 text-sm text-px-error">
                  <p>{revisionBlock}</p>
                  <Button size="sm" variant="destructive" onClick={() => submitRevision(true)} disabled={revisionSubmitting}>
                    Apply anyway (override)
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => submitRevision(false)} disabled={revisionSubmitting}>{revisionSubmitting ? "Creating…" : "Create Revision"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!comparing} onOpenChange={(o) => !o && setComparing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Compare -- &quot;{comparing?.title}&quot; (v{comparing?.version})</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Against</Label>
            <Select
              value={compareAgainst}
              onValueChange={(v) => { setCompareAgainst(v); if (comparing) void loadComparison(comparing, v); }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {boqs.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.title} (v{b.version}){!b.parentBoqId ? " — Original" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {comparisonLoading ? (
            <div className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : comparison ? (
            <div className="space-y-2">
              <p className="text-sm">
                Total variation:{" "}
                <span className={comparison.totalVariation > 0 ? "text-px-success" : comparison.totalVariation < 0 ? "text-px-error" : ""}>
                  {currencyCode ? `${currencyCode} ` : ""}{formatVariation(comparison.totalVariation)}
                </span>
              </p>
              {/* M28 COMPARE archetype (R44 seq3) -- zero bespoke rendering:
                  CompareScreen owns Added/Removed/Changed sections, warnings,
                  and per-cell highlighting; this component only reshapes
                  VERIDIAN's BoqComparison into its generic CompareResult. */}
              <div className="h-[420px] rounded-md border border-ct-border">
                <CompareScreen
                  functionId="boq.compare"
                  breadcrumb={`v${compareAgainst ? boqs.find((b) => b.id === compareAgainst)?.version ?? "?" : "?"} → v${comparing?.version ?? "?"}`}
                  columns={columns}
                  fromLabel={`v${boqs.find((b) => b.id === compareAgainst)?.version ?? "?"}`}
                  toLabel={`v${comparing?.version ?? "?"}`}
                  result={toCompareResult(comparison)}
                  getRowId={(row) => String(row.id)}
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
