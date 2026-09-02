"use client";

// Real-screen conversion (2026-08-30) -- replaces ScopeClient.tsx's old
// "New BOQ" Dialog popup with a real Object Page in create mode, same
// ObjectScreen archetype as the Scope Object Page and PermitObjectClient.
// No draft lifecycle here (unlike Permits) -- a BOQ is created in one shot
// with its full line-item set, matching the real backend's own
// createBoq() contract; there is nothing meaningful to autosave mid-typing.
//
// R67 lane D22 (item D-60, recs R-196/R-225) -- REBUILT FOR A QUANTITY SURVEYOR.
//
// WHAT WAS WRONG: a wall of placeholder-only inputs with no column headers, so
// the only way to know that the fourth narrow box was Rate and not Qty was to
// click it and read the grey text; no Amount column and no running total, so a
// QS entering a 128-line BOQ could not see the arithmetic they were doing; no
// explanation anywhere of what Code, Parent code and Breakdown % are for; and a
// Save button that was always enabled and failed AFTER the click, which is the
// exact fail-after-click pattern correction C-11 named /labour/new's
// disabled-with-reason button as the cure for.
//
// WHAT IT IS NOW: a real table with headers in Sumeet's own column order, a
// one-line help row, required markers, a computed Amount per row and a running
// BOQ total, sub-tasks whose Qty and Rate are visibly derived from their parent
// rather than editable-and-ignored, on-blur messages at the field that caused
// them, and a primary button that says what is missing before it is pressed.
//
// All of the arithmetic and every sentence live in boq-helpers.ts next to
// collectLines()'s own submission rules, so the grid and the save path can
// never disagree about what a complete line is.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrencies } from "@/lib/currency";
import { withMoney } from "@/lib/money";
import {
  childPercentNote, collectLines, createBoqSaveDisabledReason, draftBoqTotal, draftLineAmount,
  draftLineFieldMessages, emptyLine, toPayloadLineItems, NO_CATEGORY_CHIP_LABEL, type LineItemDraft,
} from "@/lib/boq-helpers";
import BoqCategorySelect, { useBoqCategories } from "@/components/BoqCategorySelect";

const HELP_LINE =
  "Code names this line so others can point at it. Parent code makes this line a sub-task of that code. Breakdown % is the share of the parent this sub-task carries.";

/** Marks a field required in the header, per the item: Title and the first line's Description/Unit/Qty/Rate. */
function Required() {
  return (
    <>
      <span aria-hidden="true" className="text-px-error"> *</span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

export default function ScopeCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  // Messages appear when a field is LEFT, not while it is being typed in --
  // telling someone their parent code is wrong on the first keystroke is noise.
  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  // R67 lane I (WS-I item I-05, R-177).
  const { categories, failed: categoriesFailed, addLocal } = useBoqCategories();
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  function markBlurred(index: number, field: string) {
    setBlurred((prev) => ({ ...prev, [`${index}:${field}`]: true }));
  }

  // "Add new" registers the category org-wide so it is offered on every other
  // line and on the next BOQ. A failure to register is NOT fatal and NOT
  // silent: the name still lands on this line (nothing the user typed is
  // lost), and the toast says the list was not updated.
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

  async function createBoq() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      toast.error(lineError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, lineItems: toPayloadLineItems(validLines) }),
      });
      let data: { id?: unknown; lineItems?: unknown; error?: unknown } | null = null;
      let parseFailed = false;
      try { data = await res.json(); } catch { parseFailed = true; }

      if (!res.ok) throw new Error((typeof data?.error === "string" && data.error) || "Couldn't create BOQ");
      if (parseFailed || !data) throw new Error("Couldn't create BOQ — the server's response was unreadable, so nothing is confirmed saved.");
      const savedId = typeof data.id === "string" ? data.id.trim() : "";
      if (!savedId) throw new Error("Couldn't create BOQ — the server did not confirm a saved BOQ. Nothing was saved.");
      const savedLineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
      if (savedLineItems < validLines.length) {
        throw new Error(`Couldn't create BOQ — ${validLines.length} line item(s) were submitted but only ${savedLineItems} came back saved.`);
      }
      toast.success("BOQ created");
      router.push(`/scope/${savedId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create BOQ");
      setSubmitting(false);
    }
  }

  const disabledReason = useMemo(() => createBoqSaveDisabledReason(title, lines), [title, lines]);
  const total = useMemo(() => draftBoqTotal(lines), [lines]);

  return (
    <ObjectScreen
      breadcrumb="Scope / New BOQ"
      title="New Bill of Quantities"
      mode="create"
      hasDraft={false}
      onSave={createBoq}
      onCancel={() => router.push(`/scope?projectId=${projectId}`)}
      onBack={() => router.push(`/scope?projectId=${projectId}`)}
      saveDisabled={submitting || !!disabledReason}
      saveDisabledReason={submitting ? "Creating…" : disabledReason ?? undefined}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        <div className="max-w-md space-y-1.5">
          <Label>Title<Required /></Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Civil Works - Phase 1" />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label>Line Items</Label>
            <span className="text-[13px]">
              <span className="text-px-muted">BOQ total </span>
              <span className="font-medium">{withMoney(currencyCode, total)}</span>
            </span>
          </div>
          <p className="text-[12px] text-px-muted">{HELP_LINE}</p>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-right">S.No</TableHead>
                  <TableHead className="min-w-[140px]">Category</TableHead>
                  <TableHead className="min-w-[110px]">Code</TableHead>
                  <TableHead className="min-w-[200px]">Description<Required /></TableHead>
                  <TableHead className="min-w-[80px]">Unit<Required /></TableHead>
                  <TableHead className="min-w-[90px] text-right">Qty<Required /></TableHead>
                  <TableHead className="min-w-[90px] text-right">Rate<Required /></TableHead>
                  <TableHead className="min-w-[110px] text-right">Amount</TableHead>
                  <TableHead className="min-w-[130px]">Parent code</TableHead>
                  <TableHead className="min-w-[110px] text-right">Breakdown %</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, i) => {
                  const isChild = !!line.parentItemCode?.trim();
                  const note = childPercentNote(lines, line.itemCode);
                  const amount = draftLineAmount(line, lines);
                  const messages = draftLineFieldMessages(line, lines);
                  const messageFor = (field: "parentItemCode" | "breakdownPercentage") =>
                    blurred[`${i}:${field}`] ? messages.find((m) => m.field === field)?.text ?? null : null;
                  const derivedTitle = "derived from parent";
                  return (
                    <TableRow key={i} className="align-top">
                      <TableCell className="pt-4 text-right text-px-muted">{i + 1}</TableCell>
                      <TableCell>
                        <BoqCategorySelect
                          value={line.category ?? ""}
                          categories={categories}
                          failed={categoriesFailed}
                          showLabel={false}
                          onChange={(next) => updateLine(i, "category", next)}
                          onAddNew={registerCategory}
                        />
                        {!line.category?.trim() && (
                          <span className="mt-1 inline-block rounded-full border border-px-border2 px-2 py-0.5 text-[10px] text-px-muted">{NO_CATEGORY_CHIP_LABEL}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input aria-label={`Line ${i + 1} Code`} value={line.itemCode ?? ""} onChange={(e) => updateLine(i, "itemCode", e.target.value)} />
                        {note && <p className="mt-1 text-[11px] text-px-muted">{note}</p>}
                      </TableCell>
                      <TableCell>
                        <Input aria-label={`Line ${i + 1} Description`} value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Input aria-label={`Line ${i + 1} Unit`} value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Line ${i + 1} Qty`} type="number" className="text-right"
                          value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)}
                          disabled={isChild} title={isChild ? derivedTitle : undefined}
                        />
                        {isChild && <p className="mt-1 text-[11px] text-px-muted">{derivedTitle}</p>}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Line ${i + 1} Rate`} type="number" className="text-right"
                          value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)}
                          disabled={isChild} title={isChild ? derivedTitle : undefined}
                        />
                        {isChild && <p className="mt-1 text-[11px] text-px-muted">{derivedTitle}</p>}
                      </TableCell>
                      {/* Amount is computed, never typed: quantity x rate for a
                          root line, and the root's amount x this line's
                          breakdown % for a sub-task -- the same formula the
                          server stores. */}
                      <TableCell className="pt-4 text-right tabular-nums">
                        {amount === null ? <span className="text-px-muted">–</span> : withMoney(currencyCode, amount)}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Line ${i + 1} Parent code`} value={line.parentItemCode ?? ""}
                          onChange={(e) => updateLine(i, "parentItemCode", e.target.value)}
                          onBlur={() => markBlurred(i, "parentItemCode")}
                        />
                        {messageFor("parentItemCode") && (
                          <p role="alert" className="mt-1 text-[11px] text-px-error">{messageFor("parentItemCode")}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Line ${i + 1} Breakdown %`} type="number" className="text-right"
                          value={line.breakdownPercentage ?? ""}
                          onChange={(e) => updateLine(i, "breakdownPercentage", e.target.value)}
                          onBlur={() => markBlurred(i, "breakdownPercentage")}
                        />
                        {messageFor("breakdownPercentage") && (
                          <p role="alert" className="mt-1 text-[11px] text-px-error">{messageFor("breakdownPercentage")}</p>
                        )}
                      </TableCell>
                      <TableCell className="pt-3">
                        <Button
                          variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`}
                          onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                          disabled={lines.length === 1}
                        >
                          ✕
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              + Add Line
            </Button>
            <span className="text-[13px]">
              <span className="text-px-muted">BOQ total </span>
              <span className="font-medium tabular-nums">{withMoney(currencyCode, total)}</span>
            </span>
          </div>
        </div>
      </div>
    </ObjectScreen>
  );
}
