"use client";

// LOCAL-FIRST shell, Scope of Work: the line grid New BOQ and New Revision share. The same columns as the online New BOQ screen
// (Description, Category, Unit, Qty, Rate, Amount, Item code, Parent code, Breakdown %), with the online screen's own arithmetic
// (boq-helpers.ts draftLineAmount / draftBoqTotal: a sub-task is priced off its ROOT line and its own Qty / Rate are not asked for).
// The category is a free-text box here: the organisation's category list is a server lookup this screen does not need to save a line.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { draftBoqTotal, draftLineAmount, childPercentSum, formatAmount, type LineItemDraft } from "@/lib/boq-helpers";
import { textInput } from "./DesignChangeShared";

export function ScopeLinesEditor({ lines, onChange, testIdPrefix }: { lines: LineItemDraft[]; onChange: (next: LineItemDraft[]) => void; testIdPrefix: string }) {
  const set = (i: number, field: keyof LineItemDraft, value: string) => onChange(lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  const cell = (i: number, field: keyof LineItemDraft, label: string, opts: { numeric?: boolean; disabled?: boolean; width?: string } = {}) => (
    <Input
      className={`${opts.width ?? "w-[90px]"} ${opts.numeric ? "text-right tabular-nums" : ""}`}
      aria-label={`${label}, line ${i + 1}`}
      data-testid={`${testIdPrefix}-${i}-${String(field)}`}
      inputMode={opts.numeric ? "decimal" : undefined}
      disabled={opts.disabled}
      value={String(lines[i]![field] ?? "")}
      {...textInput((v) => set(i, field, v))}
    />
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm" data-testid={`${testIdPrefix}-grid`}>
        <thead>
          <tr className="text-left text-[12px] text-px-muted">
            <th scope="col" className="px-1 pb-1 font-medium">Description</th>
            <th scope="col" className="px-1 pb-1 font-medium">Category</th>
            <th scope="col" className="px-1 pb-1 font-medium">Unit</th>
            <th scope="col" className="px-1 pb-1 text-right font-medium">Qty</th>
            <th scope="col" className="px-1 pb-1 text-right font-medium">Rate</th>
            <th scope="col" className="px-1 pb-1 text-right font-medium">Amount</th>
            <th scope="col" className="px-1 pb-1 font-medium">Item code</th>
            <th scope="col" className="px-1 pb-1 font-medium">Parent code</th>
            <th scope="col" className="px-1 pb-1 text-right font-medium">Breakdown %</th>
            <th scope="col" className="px-1 pb-1 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const sub = Boolean(line.parentItemCode?.trim());
            const sum = childPercentSum(lines, line.itemCode);
            const amount = draftLineAmount(line, lines);
            return (
              <tr key={i} className="align-top" data-testid={`${testIdPrefix}-row`}>
                <td className="px-1 py-1">{cell(i, "description", "Description", { width: "min-w-[200px]" })}</td>
                <td className="px-1 py-1">{cell(i, "category", "Category", { width: "w-[120px]" })}</td>
                <td className="px-1 py-1">{cell(i, "unit", "Unit", { width: "w-[80px]" })}</td>
                <td className="px-1 py-1">{cell(i, "quantity", "Qty", { numeric: true, disabled: sub })}</td>
                <td className="px-1 py-1">
                  {cell(i, "rate", "Rate", { numeric: true, disabled: sub })}
                  {sub ? <p className="mt-0.5 text-[11px] text-px-muted">derived from the root line</p> : null}
                </td>
                <td className="px-1 py-1 text-right tabular-nums text-px-muted" data-testid={`${testIdPrefix}-${i}-amount`}>{amount === null ? "-" : amount}</td>
                <td className="px-1 py-1">{cell(i, "itemCode", "Item code", { width: "w-[110px]" })}</td>
                <td className="px-1 py-1">{cell(i, "parentItemCode", "Parent code", { width: "w-[110px]" })}</td>
                <td className="px-1 py-1">
                  {cell(i, "breakdownPercentage", "Breakdown %", { numeric: true, width: "w-[100px]" })}
                  {sum !== null ? <p className="mt-0.5 text-[11px] text-px-muted">{sum}% total</p> : null}
                </td>
                <td className="px-1 py-1">
                  <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, idx) => idx !== i))}>Remove</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-px-border text-[12px]">
            <td className="px-1 pt-2 font-medium text-px-ink" colSpan={5}>BOQ total (root lines only)</td>
            <td className="px-1 pt-2 text-right font-medium tabular-nums text-px-ink" data-testid={`${testIdPrefix}-total`}>{draftBoqTotal(lines)}</td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export const money = (n: number) => formatAmount(n);
