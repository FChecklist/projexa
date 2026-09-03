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
import {
  emptyLine, childPercentSum, collectLines, toPayloadLineItems,
  // R67 D-24: the per-field sentences, from the same module the incomplete-line
  // banner reads, so one field has one message.
  lineMissingFields, LINE_FIELD_MESSAGE,
  type LineField, type LineItemDraft,
} from "@/lib/boq-helpers";
import { draftBoqTotal, draftLineAmount } from "@/lib/boq-helpers";
// R67 C-06: a multi-field create route IS the card -- band 2 stays empty
// while this form is open -- so the save reports itself back to the shell
// and the receipt line lands in the same band a composer write would use.
import { useShellChain } from "@/components/shell/shell-chain-context";
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
 * R67 D-24: one line field's complaint, rendered NEXT TO that input and tied
 * to it by id, so it is programmatically attached and not only visually near.
 * Renders nothing at all until the field has been visited and is still empty.
 */
function LineFieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-0.5 flex items-start gap-1 text-[11px] text-px-error">
      <span aria-hidden="true">⚠</span>
      <span>{message}</span>
    </p>
  );
}

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
  // R67 C-06: the shell chain context this save reports its receipt into.
  const { pushReceipt } = useShellChain();
  const [values, setValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  // R67 I-05 (R-177): the org's registered category list, shared with
  // /scope/revise so both screens offer exactly the same vocabulary.
  const { categories, failed: categoriesFailed, addLocal } = useBoqCategories();
  // A line the form can see is wrong, checked before anything is sent. Kept
  // apart from the submit's own failure so a local complaint and a server
  // refusal can never be mistaken for one another.
  const [lineError, setLineError] = useState<string | null>(null);
  // R67 I-05 x integration: registering a category org-wide can fail without
  // the SAVE failing -- the name still lands on this line. That is a separate
  // sentence from a refused save, so it has its own persistent slot rather
  // than being squeezed into `lineError` (which blocks the primary) or into a
  // toast (which is gone before it has been read).
  const [categoryNotice, setCategoryNotice] = useState<string | null>(null);
  // R67 D-24 (its acceptance's second half), folded in by the integration
  // train. Which line fields the user has actually VISITED, keyed
  // "<index>:<field>". A message is shown only for a field that has been left,
  // never for every empty box at once -- being shouted at before you have
  // started is what the finding was about, not the absence of validation.
  const [touchedLine, setTouchedLine] = useState<Record<string, boolean>>({});

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
    // Typing into a field clears its complaint immediately; it is re-checked on
    // the next blur.
    setTouchedLine((t) => (t[`${index}:${field}`] ? { ...t, [`${index}:${field}`]: false } : t));
  }

  /**
   * The sentence for ONE line field, or null. Uses the same
   * lineMissingFields/LINE_FIELD_MESSAGE pair the "Line 2 is incomplete" banner
   * and the Save label read, so a field cannot be called required in one place
   * and optional in another.
   */
  function lineFieldError(index: number, field: LineField): string | null {
    if (!touchedLine[`${index}:${field}`]) return null;
    return lineMissingFields(lines, index).includes(field) ? LINE_FIELD_MESSAGE[field] : null;
  }

  function blurLine(index: number, field: LineField) {
    setTouchedLine((t) => ({ ...t, [`${index}:${field}`]: true }));
  }

  // "Add new" registers the category org-wide so it is offered on every other
  // line and on the next BOQ. A failure to register is NOT fatal and NOT
  // silent: the name still lands on this line (nothing the user typed is
  // lost), and the message band says the list was not updated.
  async function registerCategory(name: string) {
    addLocal(name);
    setCategoryNotice(null);
    const fallback = `"${name}" was applied to this line but could not be added to the category list.`;
    try {
      const res = await fetch("/api/scope/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({}));
        setCategoryNotice(typeof data.error === "string" ? data.error : fallback);
      }
    } catch {
      setCategoryNotice(fallback);
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
      // R67 C-06: the save reports itself back to the shell -- the receipt
      // line lands in the same band a composer write's would, so a save made
      // through this real screen and one made through the composer read
      // identically.
      pushReceipt({
        text: `Saved BOQ ${(values.title ?? "").trim()} — ${savedLineItems} lines`,
        href: `/scope/${savedId}`,
      });
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
      // R67 I-05: a category that could not be REGISTERED org-wide is stated
      // here, persistently, and does not block the save -- the name is already
      // on the line and the BOQ is still correct.
      banner={
        categoryNotice ? (
          <p role="status" className="text-[12px] text-px-muted">{categoryNotice}</p>
        ) : undefined
      }
      failure={lineError ? formFailure(lineError) : submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={save}
      onCancel={() => router.push(scopeHref)}
    >
      <div className="space-y-2">
        <Label>Line Items</Label>
        {/* R67 D-24: the two hardest columns encode the whole sub-task model
            and nothing on screen said so. Both sentences are kept -- the first
            says what the codes DO, the second what the percentages must add up
            to, and neither answers the other's question. */}
        <p className="text-xs text-px-muted">
          Item Code identifies the line in reports and the WPR. Parent Item Code links a sub-task to its root line;
          Breakdown % is its share of the root&apos;s quantity.
        </p>
        <p className="text-xs text-px-muted">
          The children of one parent should add up to 100% -- the running total is shown under each Breakdown % as you type.
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
                {/* R67 lane D22 (item D-60, rec R-225), folded in at the
                    integration merge: a QS entering a 128-line BOQ could not see
                    the arithmetic they were doing. A sub-task's amount is a SHARE
                    of its root's (schema.ts's canonical child-rate rule), which is
                    what draftLineAmount() encodes, so this column is a reading of
                    the same rule the backend stores rather than a second one. */}
                <th scope="col" className="px-1 pb-1 text-right font-medium">Amount</th>
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
                        aria-invalid={lineFieldError(i, "description") ? true : undefined}
                        aria-describedby={lineFieldError(i, "description") ? `line-${i}-description-error` : undefined}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                        onBlur={() => blurLine(i, "description")}
                      />
                      <LineFieldError id={`line-${i}-description-error`} message={lineFieldError(i, "description")} />
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
                        // R67 D-24: "Category" alone is ambiguous the moment a
                        // screen renders more than one, which is every BOQ with
                        // more than one line. Same per-row form the other
                        // controls in this grid use.
                        ariaLabel={`Category, line ${i + 1}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[80px]"
                        aria-label={`Unit, line ${i + 1}`}
                        placeholder="m3"
                        value={line.unit}
                        onChange={(e) => updateLine(i, "unit", e.target.value)}
                        aria-invalid={lineFieldError(i, "unit") ? true : undefined}
                        aria-describedby={lineFieldError(i, "unit") ? `line-${i}-unit-error` : undefined}
                        onBlur={() => blurLine(i, "unit")}
                      />
                      <LineFieldError id={`line-${i}-unit-error`} message={lineFieldError(i, "unit")} />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[90px] text-right tabular-nums"
                        aria-label={`Qty, line ${i + 1}`}
                        placeholder="120"
                        type="number"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        aria-invalid={lineFieldError(i, "quantity") ? true : undefined}
                        aria-describedby={lineFieldError(i, "quantity") ? `line-${i}-quantity-error` : undefined}
                        onBlur={() => blurLine(i, "quantity")}
                        disabled={isSubTask}
                        title={isSubTask ? SUB_TASK_REASON : undefined}
                      />
                      <LineFieldError id={`line-${i}-quantity-error`} message={lineFieldError(i, "quantity")} />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="w-[90px] text-right tabular-nums"
                        aria-label={`Rate, line ${i + 1}`}
                        placeholder="45"
                        type="number"
                        value={line.rate}
                        onChange={(e) => updateLine(i, "rate", e.target.value)}
                        aria-invalid={lineFieldError(i, "rate") ? true : undefined}
                        aria-describedby={lineFieldError(i, "rate") ? `line-${i}-rate-error` : undefined}
                        onBlur={() => blurLine(i, "rate")}
                        disabled={isSubTask}
                        title={isSubTask ? SUB_TASK_REASON : undefined}
                      />
                      <LineFieldError id={`line-${i}-rate-error`} message={lineFieldError(i, "rate")} />
                      {/* The reason in WORDS, once per row, rather than only in
                          a title attribute nobody hovers. */}
                      {isSubTask && <p className="mt-0.5 text-[11px] text-px-muted">{SUB_TASK_REASON}</p>}
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums text-px-muted">
                      {draftLineAmount(line, lines) ?? "-"}
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
                        aria-invalid={lineFieldError(i, "breakdownPercentage") ? true : undefined}
                        aria-describedby={lineFieldError(i, "breakdownPercentage") ? `line-${i}-breakdownPercentage-error` : undefined}
                        onBlur={() => blurLine(i, "breakdownPercentage")}
                      />
                      <LineFieldError id={`line-${i}-breakdownPercentage-error`} message={lineFieldError(i, "breakdownPercentage")} />
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
                        {/* R67 D-24: the reason as VISIBLE text beside the
                            word. Disabled-with-a-hidden-title is how a control
                            reads as broken rather than as not-applicable. */}
                        {lines.length === 1 && <span className="ml-1 text-[11px] font-normal">(last line)</span>}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* R67 lane D22 (item D-60): the running BOQ total, over ROOT lines
                only -- adding a weighted sub-task on top of its parent would
                double-count that money, the same rule boqTotal() applies on
                the read side. */}
            <tfoot>
              <tr className="border-t border-px-border text-[12px]">
                <td className="px-1 pt-2 font-medium text-px-ink" colSpan={5}>BOQ total</td>
                <td className="px-1 pt-2 text-right font-medium tabular-nums text-px-ink">{draftBoqTotal(lines)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          + Add Line
        </Button>
      </div>
    </CreateScreen>
  );
}
