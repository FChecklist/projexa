"use client";

// Real-screen conversion (2026-08-30) -- replaced ScopeClient.tsx's old "New
// BOQ" Dialog popup with a real create route. No draft lifecycle here (unlike
// Permits): a BOQ is created in one shot with its full line-item set, matching
// the backend's own createBoq() contract, so there is nothing to autosave.
//
// ─── R67 D-67: the screen R-257 singles out ──────────────────────────────
//
// "/scope/new, the screen a quantity surveyor lives in, has a teal Save
//  enabled on an empty form and seven unlabelled inputs truncating to
//  'Parent Item Coc'."
//
// Every word of that was true, and each half was its own fault:
//
//  * SAVE WAS ENABLED ON AN EMPTY FORM. Pressing it called the API, which
//    refused, and the refusal arrived as a toast. The user learned what was
//    required by failing. The primary now names what is missing --
//    "Save (Title, Description, Qty, Rate)" -- and cannot be pressed until
//    nothing is.
//  * THE LINE GRID HAD NO HEADERS. Seven inputs in a row, each labelled only
//    by a placeholder, and a placeholder disappears the moment you type in
//    it -- so after the first row the columns were unlabelled entirely. There
//    is a real header row now, and the placeholders are short enough not to
//    truncate ("Parent code", "Breakdown %").
//  * THE TWO HARDEST COLUMNS WERE UNEXPLAINED. Parent Item Code and
//    Breakdown % encode the whole sub-task model and nothing on screen said
//    so. The help line does.
//  * "✕" WAS THE ONLY WAY TO REMOVE A LINE. A glyph with no accessible name.
//  * CATEGORY COULD NOT BE SET AT ALL. Every BOQ created here had
//    uncategorised lines, so the Work Progress report's Category-wise view had
//    nothing to group by.
//
// R67 I-05 (R-177) answers that last point properly, and this file keeps its
// answer rather than the interim one: the category is the LINE'S OWN
// registered category (construction_boq_line_items.category, with the org's
// list served by /api/scope/categories), through the shared BoqCategorySelect
// that /scope/revise also uses -- so the two screens cannot drift into
// different behaviour for the same field. The earlier `activityId` select is
// gone: a BOQ line's category is a first-class column now, not a link to a
// work-progress activity that may not exist yet.
//
// The greying of Qty/Rate on a sub-task row was already right; it keeps its
// behaviour and gains the reason in words rather than only in a title
// attribute.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit, formFailure } from "@/lib/use-submit";
import { emptyLine, childPercentSum, collectLines, toPayloadLineItems, type LineItemDraft } from "@/lib/boq-helpers";
import BoqCategorySelect, { useBoqCategories } from "@/components/BoqCategorySelect";
import type { CreateField } from "@/lib/create-screen";

const FIELDS: CreateField[] = [
  {
    name: "title",
    label: "Title",
    kind: "text",
    required: true,
    placeholder: "e.g. Civil Works — Phase 1",
    wide: true,
  },
];

const SUB_TASK_REASON = "derived from the root line";

/**
 * What the line grid still needs, in the words the header row uses. Returned
 * as labels so they can go straight into the primary's own label -- an empty
 * form reads "Save (Title, Description, Qty, Rate)".
 *
 * Category is deliberately NOT among them. R67 I-05's own rule is that a line
 * with no category is never blocked from saving: the gap is made VISIBLE (the
 * control reads "no category") rather than made fatal.
 */
function missingLineFields(lines: LineItemDraft[]): string[] {
  const val = (s: string | undefined) => (s ?? "").trim();
  const touched = lines.filter(
    (l) =>
      val(l.description) || val(l.unit) || val(l.quantity) || val(l.rate) ||
      val(l.itemCode) || val(l.parentItemCode) || val(l.breakdownPercentage) || val(l.category)
  );
  // A BOQ with no lines at all is legitimate to the backend, but it is not
  // what someone opening this screen means to create, and R-257 lists "at
  // least one complete line" as required. An untouched grid therefore names
  // the columns of the first line.
  const first = touched[0] ?? lines[0];
  if (!first) return ["Description", "Qty", "Rate"];
  const missing: string[] = [];
  if (!val(first.description)) missing.push("Description");
  if (val(first.parentItemCode)) {
    if (!val(first.breakdownPercentage)) missing.push("Breakdown %");
  } else {
    if (!val(first.quantity)) missing.push("Qty");
    if (!val(first.rate)) missing.push("Rate");
  }
  return missing;
}

export default function ScopeCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  // R67 I-05 (R-177): the org's registered category list, shared with
  // /scope/revise so both screens offer exactly the same vocabulary.
  const { categories, failed: categoriesFailed, addLocal } = useBoqCategories();
  // A line the form can see is wrong, checked before anything is sent. Kept
  // apart from the submit's own failure so a local complaint and a server
  // refusal can never be mistaken for one another.
  const [lineError, setLineError] = useState<string | null>(null);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  // "Add new" registers the category org-wide so it is offered on every other
  // line and on the next BOQ. A failure to register is NOT fatal and NOT
  // silent: the name still lands on this line (nothing the user typed is
  // lost), and the toast says the list was not updated.
  async function registerCategory(name: string) {
    addLocal(name);
    try {
      const res = await fetch("/api/scope/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  // How many lines the submit sent, so the response can be checked against
  // what was actually asked for rather than against the grid as it stands now.
  const sentLineCount = useRef(0);

  const submit = useSubmit<{ id?: unknown; lineItems?: unknown } | null>({
    objectLabel: "BOQ",
    buildRequest: () => {
      const { valid: validLines } = collectLines(lines);
      sentLineCount.current = validLines.length;
      return {
        input: "/api/scope",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            title: (values.title ?? "").trim(),
            lineItems: toPayloadLineItems(validLines),
          }),
        },
      };
    },
    onSuccess: (data) => {
      // An unreadable body over a 2xx is not a refusal: the write may well
      // have happened, and the sentence the user reads says exactly that.
      if (!data) throw new Error("The server's response was unreadable");
      const savedId = typeof data.id === "string" ? data.id.trim() : "";
      if (!savedId) throw new Error("The server did not return a BOQ id");
      const savedLineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
      if (savedLineItems < sentLineCount.current) {
        throw new Error(
          `${sentLineCount.current} line item(s) were submitted but only ${savedLineItems} came back saved`
        );
      }
      router.replace(createdHref("/scope", savedId, (values.title ?? "").trim()));
    },
  });

  function save() {
    // Checked BEFORE anything is sent, so a malformed line costs no round
    // trip and the complaint names the line rather than the request.
    const { error: invalid } = collectLines(lines);
    setLineError(invalid ?? null);
    if (invalid) return;
    submit.submit();
  }

  const scopeHref = `/scope?projectId=${encodeURIComponent(projectId)}`;

  return (
    <CreateScreen
      module="Scope"
      moduleHref={scopeHref}
      objectLabel="BOQ"
      title="New Bill of Quantities"
      fields={FIELDS}
      values={values}
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      extraMissing={missingLineFields(lines)}
      failure={lineError ? formFailure(lineError) : submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={save}
      onCancel={() => router.push(scopeHref)}
    >
      <div className="space-y-2">
        <Label>Line Items</Label>
        <p className="text-xs text-px-muted">
          Parent Item Code links a sub-task to its root line; Breakdown % is its share of the root&apos;s quantity
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              {/* The header row R-257 asks for. Placeholders vanish the moment
                  a field is typed into; a header does not. */}
              <tr className="text-left text-[12px] text-px-muted">
                <th scope="col" className="px-1 pb-1 font-medium">Description</th>
                <th scope="col" className="px-1 pb-1 font-medium">Category</th>
                <th scope="col" className="px-1 pb-1 font-medium">Unit</th>
                <th scope="col" className="px-1 pb-1 text-right font-medium">Qty</th>
                <th scope="col" className="px-1 pb-1 text-right font-medium">Rate</th>
                <th scope="col" className="px-1 pb-1 font-medium">Item code</th>
                <th scope="col" className="px-1 pb-1 font-medium">Parent code</th>
                <th scope="col" className="px-1 pb-1 text-right font-medium">Breakdown %</th>
                <th scope="col" className="px-1 pb-1 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const isSubTask = Boolean(line.parentItemCode?.trim());
                const childSum = childPercentSum(lines, line.itemCode);
                return (
                  <tr key={i} className="align-top">
                    <td className="px-1 py-1">
                      <Input
                        className="min-w-[200px]"
                        aria-label={`Description, line ${i + 1}`}
                        placeholder="Excavation to reduced level"
                        value={line.description}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      {/* R67 I-05: the org's registered list, with an inline
                          "+ Add new" so someone typing a category the org has
                          not registered yet does not have to leave the form and
                          lose their lines. A blank one is never blocked -- the
                          control itself reads "no category", so the gap is
                          visible rather than silent. If the list fails to load
                          the control degrades to free text: a broken lookup
                          must never stop someone entering a BOQ. The visible
                          label lives in the header row above, so showLabel
                          stays false on every row and the control keeps its
                          per-row aria-label. */}
                      <BoqCategorySelect
                        value={line.category ?? ""}
                        categories={categories}
                        failed={categoriesFailed}
                        onChange={(next) => updateLine(i, "category", next)}
                        onAddNew={registerCategory}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[80px]"
                        aria-label={`Unit, line ${i + 1}`}
                        placeholder="m3"
                        value={line.unit}
                        onChange={(e) => updateLine(i, "unit", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[90px] text-right tabular-nums"
                        aria-label={`Qty, line ${i + 1}`}
                        placeholder="120"
                        type="number"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        disabled={isSubTask}
                        title={isSubTask ? SUB_TASK_REASON : undefined}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[90px] text-right tabular-nums"
                        aria-label={`Rate, line ${i + 1}`}
                        placeholder="45"
                        type="number"
                        value={line.rate}
                        onChange={(e) => updateLine(i, "rate", e.target.value)}
                        disabled={isSubTask}
                        title={isSubTask ? SUB_TASK_REASON : undefined}
                      />
                      {/* The reason in WORDS, once per row, rather than only in
                          a title attribute nobody hovers. */}
                      {isSubTask && <p className="mt-0.5 text-[11px] text-px-muted">{SUB_TASK_REASON}</p>}
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[110px]"
                        aria-label={`Item code, line ${i + 1}`}
                        placeholder="A-10"
                        value={line.itemCode ?? ""}
                        onChange={(e) => updateLine(i, "itemCode", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[110px]"
                        aria-label={`Parent code, line ${i + 1}`}
                        placeholder="A-10"
                        value={line.parentItemCode ?? ""}
                        onChange={(e) => updateLine(i, "parentItemCode", e.target.value)}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[100px] text-right tabular-nums"
                        aria-label={`Breakdown %, line ${i + 1}`}
                        placeholder="40"
                        type="number"
                        value={line.breakdownPercentage ?? ""}
                        onChange={(e) => updateLine(i, "breakdownPercentage", e.target.value)}
                      />
                      {childSum != null && <p className="mt-0.5 text-[11px] text-px-muted">{childSum}% total</p>}
                    </td>
                    <td className="px-1 py-1">
                      {/* A word, not a glyph. "✕" had no accessible name at all. */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={lines.length === 1}
                        title={lines.length === 1 ? "A BOQ needs at least one line" : undefined}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          + Add Line
        </Button>
      </div>
    </CreateScreen>
  );
}
