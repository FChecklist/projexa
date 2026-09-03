"use client";

// Real-screen conversion (2026-08-30, owner directive: "real screens with
// real built the SAP way — real Object Page routes, real Back/Edit/Delete").
// This is the Scope (BOQ) Object Page — the real replacement for
// ScopeClient.tsx's old "View" Dialog popup. Built on the SAME ObjectScreen
// archetype PermitObjectClient.tsx already proves works (real display mode,
// real Back preserving ?projectId=, real Delete gated on the backend's own
// rule). ObjectScreen's footer is fixed to Edit/Delete/Save/Cancel only (no
// generic custom-action slot) — BOQ's own workflow actions (Submit for
// Approval / Approve / Create Revision / Compare) render as a real toolbar
// in the body instead, immediately below the header, matching a real SAP
// Object Page's own object-specific action bar.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
// R67 D-22: the PROJEXA-local fork of the kit's ObjectScreen (programme
// decision D-09 -- the kit cannot be released from this machine). The fork
// always renders Edit and Delete and shows the reason beside a disabled one;
// the kit hid both entirely, which is exactly the fault this item closes. Only
// the scope screens are re-pointed here -- every other screen keeps importing
// the kit until its own item forks it.
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useCurrencies } from "@/lib/currency";
import { revisionLabel } from "@/lib/boq-lineage";
import { EMPTY_VALUE } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import {
  type Boq, type BoqLineItemRow, type Vendor,
  boqTotal, withCurrency, childPercentSum, derivedSubQtyRate, NO_CATEGORY_CHIP_LABEL,
} from "@/lib/boq-helpers";
import BoqCategorySelect, { useBoqCategories } from "@/components/BoqCategorySelect";

// Real StatusTone values only ("needs-you" | "running" | "waiting" | "done" |
// "late" | "neutral" -- veridian-ui-kit/screens/types.ts). "submitted"
// genuinely needs a manager's action, so "needs-you"; "superseded" is just a
// historical, no-longer-current revision, not a failure, so plain "neutral".
const STATUS_TONE: Record<string, "needs-you" | "running" | "waiting" | "done" | "late" | "neutral"> = {
  draft: "neutral", submitted: "needs-you", approved: "done", superseded: "neutral",
};

/** R67 D-27: the Architect/Site Instruction record that authorises a revision (compliance.construction_site_instructions). */
type SiteInstruction = { id: string; siNumber: number; boqId: string | null; issueDate: string };

export default function ScopeObjectClient({
  boqId,
  importedNotice = null,
  attachedFileName = null,
}: {
  boqId: string;
  /**
   * R67 D-25: the "Imported BOQ <title> · Rev0 · N lines" confirmation, carried
   * here in ?imported= because the import screen that produced it unmounts with
   * the navigation. A persistent notice in the message band, never a toast.
   */
  importedNotice?: string | null;
  /** R67 D-27: "Attached: SI-2026-014.pdf", carried here in ?attached= by the revise screen for the same reason. */
  attachedFileName?: string | null;
}) {
  const router = useRouter();
  const [boq, setBoq] = useState<Boq | null>(null);
  const [rows, setRows] = useState<BoqLineItemRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // R67 lane I (WS-I item I-05, R-177): the org's category list, so the
  // Category column is a real pick-list here too and not free text that would
  // invent a new category on every typo.
  const { categories, failed: categoriesFailed, addLocal } = useBoqCategories();
  // R67 D-27: the revision's own context -- who superseded it, what it
  // supersedes, and the instruction that authorised the change.
  const [successor, setSuccessor] = useState<Boq | null>(null);
  const [predecessor, setPredecessor] = useState<Boq | null>(null);
  const [variationVsParent, setVariationVsParent] = useState<number | null>(null);
  const [siteInstruction, setSiteInstruction] = useState<SiteInstruction | null>(null);
  const [siteInstructionFile, setSiteInstructionFile] = useState<string | null>(null);
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";
  const orgMoney = useOrgMoney();

  async function load() {
    setLoading(true);
    try {
      // The real backend response for GET /api/scope/{id} is the BOQ's own
      // fields PLUS lineItems -- one real call, matching how the old View
      // dialog loaded it. Vendors fetched alongside for the inline vendor
      // Select (real, already-working PATCH per line item).
      const [data, vendorsData] = await Promise.all([
        fetchJson<Boq & { lineItems: BoqLineItemRow[] }>(`/api/scope/${boqId}`),
        fetchJson<{ vendors: Vendor[] }>(`/api/vendors`).catch(() => ({ vendors: [] })),
      ]);
      setBoq({ id: data.id, projectId: data.projectId, version: data.version, title: data.title, status: data.status, parentBoqId: data.parentBoqId, createdAt: data.createdAt });
      setRows(data.lineItems ?? []);
      setVendors(vendorsData.vendors ?? []);
      setLoadError(null);
      void loadRevisionContext(data);
    } catch (err) {
      setBoq(null);
      setLoadError(errorMessage(err, "Couldn't load this BOQ"));
    } finally {
      setLoading(false);
    }
  }

  /**
   * R67 D-27: everything a revision needs to explain itself -- which revision
   * superseded this one, what this one supersedes and by how much, and whether
   * a site instruction authorises it.
   *
   * Deliberately fired AFTER the BOQ itself has rendered and never awaited by
   * load(): none of it is required to read the scope, so a slow or failing
   * lookup must degrade to a missing banner, never to a blocked page.
   */
  async function loadRevisionContext(data: Boq) {
    const [siblings, instructions, comparison] = await Promise.all([
      fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(data.projectId)}`).catch(() => ({ boqs: [] })),
      fetchJson<{ siteInstructions?: SiteInstruction[] }>(`/api/site-instructions?projectId=${encodeURIComponent(data.projectId)}`).catch(() => ({ siteInstructions: [] })),
      data.parentBoqId
        ? fetchJson<{ totalVariation?: number }>(`/api/scope/${data.id}/compare`).catch(() => null)
        : Promise.resolve(null),
    ]);

    setSuccessor((siblings.boqs ?? []).find((b) => b.parentBoqId === data.id) ?? null);
    setPredecessor((siblings.boqs ?? []).find((b) => b.id === data.parentBoqId) ?? null);
    setVariationVsParent(typeof comparison?.totalVariation === "number" ? comparison.totalVariation : null);

    const instruction = (instructions.siteInstructions ?? []).find((si) => si.boqId === data.id) ?? null;
    setSiteInstruction(instruction);
    if (!instruction) return;
    const docs = await fetchJson<{ documents?: { name?: string }[] }>(
      `/api/documents?linkedEntityType=construction_site_instruction&linkedEntityId=${encodeURIComponent(instruction.id)}`
    ).catch(() => ({ documents: [] }));
    setSiteInstructionFile(docs.documents?.[0]?.name ?? null);
  }

  useEffect(() => { load(); }, [boqId]);

  /**
   * R67 D-26: the inline budget cells confirm IN PLACE -- a "Saved" tick beside
   * the cell for 2 s -- rather than firing a toast in the corner of the screen
   * for every one of what can be four edits on a single row. A FAILURE is still
   * loud, because a silently unsaved cost figure is the worst outcome here.
   */
  const [savedCells, setSavedCells] = useState<Record<string, true>>({});
  function markSaved(cellKey: string) {
    setSavedCells((prev) => ({ ...prev, [cellKey]: true }));
    setTimeout(() => {
      setSavedCells((prev) => {
        const next = { ...prev };
        delete next[cellKey];
        return next;
      });
    }, 2000);
  }

  // R67 lane I (I-03/I-05) + D-26: ONE write path for every per-line budget
  // field -- percentage, vendor, category and the material/manpower split --
  // not a second endpoint per column.
  async function saveLineItemBudget(
    rowId: string,
    patch: { budgetPercentage?: number; vendorId?: string | null; vendorAmount?: number | null; category?: string | null; materialAmount?: number | null; manpowerAmount?: number | null },
    cellKey: string
  ) {
    setSavingRowId(rowId);
    try {
      const res = await fetch(`/api/scope/line-items/${rowId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...data } : r)));
      markSaved(cellKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save budget/vendor");
    } finally {
      setSavingRowId(null);
    }
  }

  // R67 lane I (I-05): "Add new" from the Category column registers the
  // category org-wide. A registration failure is surfaced, never swallowed --
  // but the name is still applied to the line, so nothing the user did is lost.
  async function registerCategory(name: string) {
    addLocal(name);
    try {
      const res = await fetch("/api/scope/categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? `"${name}" was applied to this line but could not be added to the category list.`);
      }
    } catch {
      toast.error(`"${name}" was applied to this line but could not be added to the category list.`);
    }
  }

  /**
   * One place that turns a money input's blur into a patch value: "" clears the
   * cell back to NOT COSTED (null), a real number is a real number, and
   * anything else is ignored rather than written as 0. The distinction matters
   * everywhere downstream -- an en dash means "nobody has costed this", and
   * "AED 0" means somebody costed it at zero.
   */
  function readMoneyInput(raw: string): number | null | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  }

  async function runAction(action: "submit" | "approve" | "delete") {
    setActionBusy(action);
    try {
      const method = action === "delete" ? "DELETE" : "POST";
      const path = action === "delete" ? `/api/scope/${boqId}` : `/api/scope/${boqId}/${action}`;
      const res = await fetch(path, { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't ${action} this BOQ`);
      if (action === "delete") {
        toast.success("BOQ deleted");
        router.push(`/scope?projectId=${boq!.projectId}`);
        return;
      }
      toast.success(action === "submit" ? "Submitted for approval" : "Approved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't ${action} this BOQ`);
    } finally {
      setActionBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (loading || !boq) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const total = boqTotal(rows);
  const isDraft = boq.status === "draft";

  return (
    <>
    {/* R67 A-21 -- THE STRIP NAMES THIS BOQ, AND ITS PROJECT.
        Rendered here, after the fetch, because that is the first moment this
        page can answer honestly: /scope/<id> resolves nothing on the server and
        carries no ?projectId=, so before `boq` exists the composer's strip has
        no title to show and (until now) fell back to whatever project the top
        rail happened to be on -- which could name a DIFFERENT project than the
        line items rendered below. The kind word "BOQ" is not written here; it
        comes from src/lib/object-screens.ts so every screen showing one uses
        the same word. Renders nothing. */}
    <ObjectContext moduleId="scope" label={boq.title} projectId={boq.projectId} />
    <ObjectScreen
      breadcrumb="Scope / Bill of Quantities"
      title={boq.title}
      subtitle={`Version ${boq.version}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[boq.status] ?? "neutral", label: boq.status }}
      facets={[
        { label: "Total (root lines only)", value: withCurrency(currencyCode, total) },
        { label: "Line items", value: String(rows.length) },
        // R67 D-27: always present. An en dash says "no instruction is on file
        // for this revision", which is a real and useful answer -- the facet
        // disappearing entirely was not. (It names the attachment rather than
        // linking it: this product has no document-download endpoint to link to
        // -- projexa's /api/documents/[id] proxies a VERIDIAN route that does
        // not exist -- and a link to nowhere is worse than an honest name.)
        {
          label: "Site instruction",
          value: siteInstruction
            ? `SI-${siteInstruction.siNumber}${siteInstructionFile ? ` · ${siteInstructionFile}` : ""}`
            : "–",
        },
      ]}
      // Real Delete, gated exactly on the backend's own rule (draft-only) —
      // never a fake-enabled button that fails after the click. R67 D-22:
      // onDelete is now passed UNCONDITIONALLY. Previously it was withheld on
      // anything but a draft, and the kit's ObjectScreen answered a missing
      // handler by rendering nothing at all — so on every approved or
      // superseded BOQ (the majority of rows) the user saw no Delete and no
      // reason. The fork renders it disabled with the reason beside the word.
      onDelete={() => runAction("delete")}
      deleteDisabledReason={isDraft ? undefined : "Only a draft BOQ can be deleted"}
      // Edit was never offered on this screen at all (no onEdit was ever
      // passed), for a real reason: a BOQ's lines are immutable once issued and
      // change through a revision. That reason is now on screen instead of
      // being inferable only from the absence of a button. The line-level
      // budget/vendor cells below stay directly editable — they are commercial
      // annotation, not the scope itself.
      editDisabledReason="Lines change through a revision - use Create Revision"
      // Real Back, preserving ?projectId= — derived from the loaded BOQ
      // itself (same pattern as PermitObjectClient's permit.projectId), not
      // a page-level query param, so Back is correct even from a bookmarked
      // /scope/{id} URL with no ?projectId= at all. router.back() alone has
      // no history entry to return to after a full reload.
      onBack={() => router.push(`/scope?projectId=${boq.projectId}`)}
      messages={[
        ...(importedNotice ? [{ level: "success" as const, text: importedNotice }] : []),
        ...(attachedFileName ? [{ level: "success" as const, text: `Attached: ${attachedFileName}` }] : []),
      ]}
    >
      {/* R67 D-27: a superseded BOQ used to say only "superseded" -- true, and
          useless. It never named the revision that replaced it, so a user
          reading last month's rates had no way to reach the current ones, and
          no way to know which revision the Work Progress Report is priced off. */}
      {successor && (
        <div className="border-b border-ct-border bg-px-cloud px-4 py-2 text-[12.5px] text-px-ink">
          Superseded by {revisionLabel(successor.version)} - the WPR now reads {revisionLabel(successor.version)}.{" "}
          <button type="button" className="underline" onClick={() => router.push(`/scope/${successor.id}`)}>
            Open {revisionLabel(successor.version)}
          </button>
        </div>
      )}
      {predecessor && (
        <div className="border-b border-ct-border px-4 py-2 text-[12.5px] text-px-ink">
          Supersedes {revisionLabel(predecessor.version)} · variation{" "}
          {/* WS-G's one money formatter: the direction is in the glyph and the
              explicit sign, never in the colour, and a figure we do not have is
              the empty-value dash rather than a fabricated zero. */}
          {typeof variationVsParent === "number" ? (
            <span className="text-ct-navy">{orgMoney.signedMoney(variationVsParent)}</span>
          ) : (
            <span className="text-px-muted" title="Variation unavailable">{EMPTY_VALUE}</span>
          )}{" "}
          <button type="button" className="underline" onClick={() => router.push(`/scope/${boqId}/compare`)}>
            Compare
          </button>
        </div>
      )}
      {/* Real, object-specific workflow toolbar — BOQ's own actions, since
          ObjectScreen's fixed footer has no slot for anything beyond
          Edit/Delete/Save/Cancel. Every button here maps to a real endpoint
          this same pass either confirmed or (submit/approve) built for the
          first time — see api/scope/[id]/submit and .../approve. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ct-border px-4 py-3">
        {isDraft && (
          <Button size="sm" disabled={actionBusy !== null} onClick={() => runAction("submit")}>
            {actionBusy === "submit" ? "Submitting…" : "Submit for Approval"}
          </Button>
        )}
        {boq.status === "submitted" && (
          <Button size="sm" disabled={actionBusy !== null} onClick={() => runAction("approve")}>
            {actionBusy === "approve" ? "Approving…" : "Approve"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => router.push(`/scope/${boqId}/revise`)}>
          Create Revision
        </Button>
        {boq.parentBoqId && (
          <Button size="sm" variant="outline" onClick={() => router.push(`/scope/${boqId}/compare`)}>
            Compare to Previous
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-ct-muted">This BOQ has no line items.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              {/* R67 I-05 (R-177): the line's real category, editable in place
                  and saved through the same PATCH as Budget %/Vendor. */}
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Budget %</TableHead><TableHead className="text-right">Budget</TableHead>
              <TableHead>Vendor</TableHead>
              {/* R67 I-03 / D-26: the three committed-cost columns, in the
                  order Sumeet's own budget model names them -- vendor, then
                  the material/manpower split. All three are MoneyCostCells, so
                  a blank one reads as NOT COSTED rather than as zero. */}
              <TableHead className="text-right">Vendor Amt</TableHead>
              <TableHead className="text-right">Material</TableHead><TableHead className="text-right">Manpower</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isSub = !!r.parentLineItemId;
              const derived = isSub ? derivedSubQtyRate(r, rows) : null;
              const childSum = !isSub ? childPercentSum(rows.map((row) => ({
                description: row.description, unit: row.unit, quantity: row.quantity, rate: row.rate,
                itemCode: row.itemCode ?? undefined, parentItemCode: rows.find((p) => p.id === row.parentLineItemId)?.itemCode ?? undefined,
                breakdownPercentage: row.breakdownPercentage ?? undefined,
              })), r.itemCode ?? undefined) : null;
              const saving = savingRowId === r.id;
              const budget = r.computedBudget ?? (Number(r.amount) * (Number(r.budgetPercentage ?? 0) / 100));
              return (
                <TableRow key={r.id}>
                  <TableCell className={isSub ? "pl-8 text-ct-muted" : "font-medium text-ct-navy"}>
                    {r.description}
                    {r.itemCode && <span className="ml-2 font-mono text-[10px] text-ct-muted">{r.itemCode}</span>}
                    {isSub && r.breakdownPercentage && <span className="ml-2 text-[10px] text-ct-muted">{r.breakdownPercentage}% of parent</span>}
                    {!isSub && childSum !== null && <span className="ml-2 text-[10px] text-ct-muted">(children: {childSum}%)</span>}
                  </TableCell>
                  <TableCell>
                    <BoqCategorySelect
                      value={r.category ?? ""}
                      categories={categories}
                      failed={categoriesFailed}
                      onChange={(next) => saveLineItemBudget(r.id, { category: next.trim() === "" ? null : next }, `${r.id}:category`)}
                      onAddNew={registerCategory}
                    />
                    {!r.category && (
                      <span className="ml-1 text-[10px] text-ct-muted">{NO_CATEGORY_CHIP_LABEL}</span>
                    )}
                    <SavedTick shown={!!savedCells[`${r.id}:category`]} />
                  </TableCell>
                  <TableCell className="text-ct-muted">{r.unit}</TableCell>
                  <TableCell className="text-right">{isSub ? (derived?.qty ?? "—") : r.quantity}</TableCell>
                  <TableCell className="text-right">{isSub ? (derived ? derived.rate.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—") : r.rate}</TableCell>
                  <TableCell className="text-right font-medium">{withCurrency(currencyCode, r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`Budget % for ${r.description}`}
                      type="number" disabled={saving} className="w-20 text-right tabular-nums" defaultValue={r.budgetPercentage ?? "25"}
                      onBlur={(e) => {
                        const pct = Number(e.target.value);
                        if (!Number.isFinite(pct)) return;
                        saveLineItemBudget(r.id, { budgetPercentage: pct }, `${r.id}:budgetPercentage`);
                      }}
                    />
                    <SavedTick shown={!!savedCells[`${r.id}:budgetPercentage`]} />
                  </TableCell>
                  <TableCell className="text-right text-ct-muted tabular-nums">{withCurrency(currencyCode, budget)}</TableCell>
                  <TableCell>
                    <Select disabled={saving} value={r.vendorId ?? undefined} onValueChange={(vendorId) => saveLineItemBudget(r.id, { vendorId }, `${r.id}:vendorId`)}>
                      <SelectTrigger className="w-[150px]"><SelectValue placeholder="No vendor" /></SelectTrigger>
                      <SelectContent>
                        {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <SavedTick shown={!!savedCells[`${r.id}:vendorId`]} />
                  </TableCell>
                  <MoneyCostCell
                    label={`Vendor amount for ${r.description}`}
                    value={r.vendorAmount}
                    currencyCode={currencyCode}
                    disabled={saving}
                    saved={!!savedCells[`${r.id}:vendorAmount`]}
                    onCommit={(amount) => saveLineItemBudget(r.id, { vendorAmount: amount }, `${r.id}:vendorAmount`)}
                    readMoneyInput={readMoneyInput}
                  />
                  <MoneyCostCell
                    label={`Material amount for ${r.description}`}
                    value={r.materialAmount}
                    currencyCode={currencyCode}
                    disabled={saving}
                    saved={!!savedCells[`${r.id}:materialAmount`]}
                    onCommit={(amount) => saveLineItemBudget(r.id, { materialAmount: amount }, `${r.id}:materialAmount`)}
                    readMoneyInput={readMoneyInput}
                  />
                  <MoneyCostCell
                    label={`Manpower amount for ${r.description}`}
                    value={r.manpowerAmount}
                    currencyCode={currencyCode}
                    disabled={saving}
                    saved={!!savedCells[`${r.id}:manpowerAmount`]}
                    onCommit={(amount) => saveLineItemBudget(r.id, { manpowerAmount: amount }, `${r.id}:manpowerAmount`)}
                    readMoneyInput={readMoneyInput}
                  />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </ObjectScreen>
    </>
  );
}

/** R67 D-26: the in-place confirmation that replaced a toast per edited cell. */
function SavedTick({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <span role="status" className="ml-1 text-[11px] text-px-success">✓ Saved</span>
  );
}

/**
 * R67 D-26: one committed-cost cell -- vendor, material or manpower. Prefixed
 * with the org currency, right-aligned with tabular numerals so a column of
 * them lines up, and EMPTY MEANS NOT COSTED: the placeholder is an en dash, and
 * clearing the box writes null rather than 0. "AED 0" and "–" are different
 * answers and this control keeps them different.
 */
function MoneyCostCell({
  label, value, currencyCode, disabled, saved, onCommit, readMoneyInput,
}: {
  label: string;
  value: string | number | null | undefined;
  currencyCode: string;
  disabled: boolean;
  saved: boolean;
  onCommit: (amount: number | null) => void;
  readMoneyInput: (raw: string) => number | null | undefined;
}) {
  return (
    <TableCell className="text-right">
      <span className="inline-flex items-center justify-end gap-1">
        {currencyCode && <span className="text-[11px] text-px-muted">{currencyCode}</span>}
        <Input
          aria-label={label}
          type="number"
          inputMode="decimal"
          min={0}
          disabled={disabled}
          className="w-24 text-right tabular-nums"
          defaultValue={value ?? ""}
          placeholder="–"
          onBlur={(e) => {
            const amount = readMoneyInput(e.target.value);
            if (amount === undefined) return; // not a number -- leave the cell alone rather than writing 0
            onCommit(amount);
          }}
        />
      </span>
      <SavedTick shown={saved} />
    </TableCell>
  );
}
