"use client";

// R67 D-24 (R-061 / R-067). The BOQ line grid, shared by ScopeCreateClient and
// ScopeReviseClient so the header row, the field messages, the Remove wording
// and the Category select exist ONCE rather than in two copies that drift.
//
// WHAT THIS CLOSES, all observed on the shipped grid:
//  - There were no visible column labels at all, only placeholders inside the
//    boxes, which disappear the moment a cell is filled. The widest headings
//    ("Parent Item Code", "Breakdown %") truncated to "Parent Item Coc" and
//    "Breakdowi" inside their own inputs.
//  - Nothing validated until Save, so an incomplete line was discovered after
//    the click, in a toast, naming the line but not the field.
//  - Remove was an icon-only "✕" -- unlabelled for a screen reader and
//    silently inert on the last row with no reason given.
//  - There was nowhere to say which trade a line belongs to, so the Work
//    Progress Report's category-wise view read "Uncategorized" for every line.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BoqCategorySelect, { type BoqCategory } from "@/components/BoqCategorySelect";
import {
  LINE_FIELD_MESSAGE, childPercentSum, isUntouchedLine, lineMissingFields,
  type LineField, type LineItemDraft,
} from "@/lib/boq-helpers";

// Fixed widths, shared by the header cell and the input beneath it, so the two
// stay in one column. "Parent Item Code" and "Breakdown %" are deliberately
// wider than the rest: they are the two headings that used to clip.
const COL = {
  description: "min-w-[180px] flex-1",
  unit: "w-[80px] shrink-0",
  quantity: "w-[90px] shrink-0",
  rate: "w-[90px] shrink-0",
  itemCode: "w-[110px] shrink-0",
  parentItemCode: "w-[150px] shrink-0",
  breakdownPercentage: "w-[120px] shrink-0",
  category: "w-[150px] shrink-0",
  remove: "w-[120px] shrink-0",
} as const;

export const BOQ_GRID_HELP =
  "Item Code identifies the line in reports and the WPR. For a sub-task, enter its Parent Item Code and a Breakdown % - children of one parent should add up to 100%.";

export type BoqLineGridProps = {
  lines: LineItemDraft[];
  /**
   * The org's editable trade list (compliance.construction_boq_categories),
   * loaded once per screen by lane I's useBoqCategories(). This grid renders
   * the list; it never invents one -- there is exactly one BOQ category
   * vocabulary in the product and it is that table.
   */
  categories: BoqCategory[];
  /** True when the category list could not be loaded: the control degrades to free text rather than offering nothing. */
  categoriesFailed?: boolean;
  onUpdate: (index: number, field: keyof LineItemDraft, value: string) => void;
  /** Registers a category typed inline, org-wide. Required: every screen that shows this grid can add one. */
  onAddCategory: (name: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
};

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1 flex items-start gap-1 text-[11px] leading-tight text-px-error">
      <span aria-hidden="true">⚠</span>
      <span>{message}</span>
    </p>
  );
}

export default function BoqLineGrid({ lines, categories, categoriesFailed, onUpdate, onAddCategory, onRemove, onAdd }: BoqLineGridProps) {
  // Validation is ON BLUR, never while a user is still typing into an empty
  // box -- a message that appears on the first keystroke of an empty field is
  // noise, not help.
  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  const markBlurred = (index: number, field: LineField) =>
    setBlurred((prev) => ({ ...prev, [`${index}:${field}`]: true }));

  function errorFor(index: number, field: LineField): string | null {
    if (!blurred[`${index}:${field}`]) return null;
    // An untouched extra row is a legitimate empty row, not a mistake -- only
    // line 1 and rows a human has actually put something in are held to this.
    if (index > 0 && isUntouchedLine(lines[index])) return null;
    return lineMissingFields(lines, index).includes(field) ? LINE_FIELD_MESSAGE[field] : null;
  }

  return (
    <div className="space-y-2">
      {/* Real, visible column labels above the grid. aria-hidden because each
          input below carries its own aria-label -- a screen reader should hear
          the field name once, not twice. */}
      <div aria-hidden="true" className="flex flex-wrap items-end gap-2 text-[11px] font-medium uppercase tracking-wide text-px-muted">
        <span className={COL.description}>Description</span>
        <span className={COL.unit}>Unit</span>
        <span className={COL.quantity}>Qty</span>
        <span className={COL.rate}>Rate</span>
        <span className={COL.itemCode}>Item Code</span>
        <span className={COL.parentItemCode}>Parent Item Code</span>
        <span className={COL.breakdownPercentage}>Breakdown %</span>
        <span className={COL.category}>Category</span>
        <span className={COL.remove} />
      </div>

      {lines.map((line, i) => {
        const isSub = !!line.parentItemCode?.trim();
        const childSum = childPercentSum(lines, line.itemCode);
        const descriptionError = errorFor(i, "description");
        const unitError = errorFor(i, "unit");
        const quantityError = errorFor(i, "quantity");
        const rateError = errorFor(i, "rate");
        const breakdownError = errorFor(i, "breakdownPercentage");
        return (
          <div key={i} className="flex flex-wrap items-start gap-2">
            <div className={COL.description}>
              <Input
                aria-label={`Line ${i + 1} Description`}
                aria-invalid={!!descriptionError}
                aria-describedby={descriptionError ? `line-${i}-description-error` : undefined}
                placeholder="Description"
                value={line.description}
                onChange={(e) => onUpdate(i, "description", e.target.value)}
                onBlur={() => markBlurred(i, "description")}
              />
              {descriptionError && <FieldError id={`line-${i}-description-error`} message={descriptionError} />}
              {/* The running child total the Owner asked for, said in words
                  rather than a bare "60% total". */}
              {childSum !== null && (
                <p className="mt-1 text-[11px] text-px-muted">Children: {childSum}% of 100%</p>
              )}
            </div>

            <div className={COL.unit}>
              <Input
                aria-label={`Line ${i + 1} Unit`}
                aria-invalid={!!unitError}
                aria-describedby={unitError ? `line-${i}-unit-error` : undefined}
                placeholder="Unit"
                value={line.unit}
                onChange={(e) => onUpdate(i, "unit", e.target.value)}
                onBlur={() => markBlurred(i, "unit")}
              />
              {unitError && <FieldError id={`line-${i}-unit-error`} message={unitError} />}
            </div>

            <div className={COL.quantity}>
              <Input
                aria-label={`Line ${i + 1} Qty`}
                aria-invalid={!!quantityError}
                aria-describedby={quantityError ? `line-${i}-quantity-error` : undefined}
                placeholder="Qty"
                type="number"
                inputMode="decimal"
                value={line.quantity}
                onChange={(e) => onUpdate(i, "quantity", e.target.value)}
                onBlur={() => markBlurred(i, "quantity")}
                disabled={isSub}
                title={isSub ? "A sub-task's quantity comes from its root line -- this field is not used" : undefined}
              />
              {quantityError && <FieldError id={`line-${i}-quantity-error`} message={quantityError} />}
            </div>

            <div className={COL.rate}>
              <Input
                aria-label={`Line ${i + 1} Rate`}
                aria-invalid={!!rateError}
                aria-describedby={rateError ? `line-${i}-rate-error` : undefined}
                placeholder="Rate"
                type="number"
                inputMode="decimal"
                value={line.rate}
                onChange={(e) => onUpdate(i, "rate", e.target.value)}
                onBlur={() => markBlurred(i, "rate")}
                disabled={isSub}
                title={isSub ? "A sub-task's rate is derived from its root line's rate x breakdown % -- this field is not used" : undefined}
              />
              {rateError && <FieldError id={`line-${i}-rate-error`} message={rateError} />}
            </div>

            <div className={COL.itemCode}>
              <Input
                aria-label={`Line ${i + 1} Item Code`}
                placeholder="Item Code"
                value={line.itemCode ?? ""}
                onChange={(e) => onUpdate(i, "itemCode", e.target.value)}
              />
            </div>

            <div className={COL.parentItemCode}>
              <Input
                aria-label={`Line ${i + 1} Parent Item Code`}
                placeholder="Parent Item Code"
                value={line.parentItemCode ?? ""}
                onChange={(e) => onUpdate(i, "parentItemCode", e.target.value)}
              />
            </div>

            <div className={COL.breakdownPercentage}>
              <Input
                aria-label={`Line ${i + 1} Breakdown %`}
                aria-invalid={!!breakdownError}
                aria-describedby={breakdownError ? `line-${i}-breakdown-error` : undefined}
                placeholder="Breakdown %"
                type="number"
                inputMode="decimal"
                value={line.breakdownPercentage ?? ""}
                onChange={(e) => onUpdate(i, "breakdownPercentage", e.target.value)}
                onBlur={() => markBlurred(i, "breakdownPercentage")}
              />
              {breakdownError && <FieldError id={`line-${i}-breakdown-error`} message={breakdownError} />}
            </div>

            <div className={COL.category}>
              {/* Lane I's control, not a second one: it owns the org list, the
                  inline "Add new", and the free-text fallback when the list
                  cannot be loaded. */}
              <BoqCategorySelect
                value={line.category ?? ""}
                categories={categories}
                failed={Boolean(categoriesFailed)}
                onChange={(value) => onUpdate(i, "category", value)}
                onAddNew={onAddCategory}
              />
            </div>

            {/* The word, not an icon -- and when it cannot act, the REASON is
                beside it rather than the control simply being inert. */}
            <div className={COL.remove}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onRemove(i)}
                disabled={lines.length === 1}
                title={lines.length === 1 ? "last line" : undefined}
              >
                Remove{lines.length === 1 ? <span className="text-[11px] font-normal"> (last line)</span> : null}
              </Button>
            </div>
          </div>
        );
      })}

      <Button variant="outline" size="sm" onClick={onAdd}>+ Add Line</Button>
      <p className="text-[11.5px] text-px-muted">{BOQ_GRID_HELP}</p>
    </div>
  );
}
