"use client";

// R67 E-13 (R-131 / R-138). The Project Status figures, in bands, in one money
// format, with the raw cuid gone and the two percentages explained.
//
// It replaces ReportOutput's generic scalar grid for this one report -- not
// because a generic grid is wrong, but because THIS payload has an order, a
// grouping and two figures that need a sentence, and none of that survives
// Object.entries.

import { MONEY_CELL_CLASS, type MoneyFormat } from "@/lib/format-money";
import { EMPTY_VALUE } from "@/lib/format-number";
import {
  LEDGER_BUDGET_LABEL,
  NOT_RECORDED_TITLE,
  PERCENT_DIVERGENCE_NOTE,
  REPORT_FIELD_GROUPS,
  fieldsInGroup,
  reportValueFormatter,
} from "@/components/report-format";

export type ProjectStatusPayload = Record<string, unknown>;

export function ProjectStatusCard({
  data,
  format,
  /** True when the reader's role hides the money figures -- a different fact from "there is none". */
  financialsRedacted = false,
}: {
  data: ProjectStatusPayload;
  format: MoneyFormat;
  financialsRedacted?: boolean;
}) {
  const value = reportValueFormatter(format);
  const ledgerBudget = data.ledgerBudget;

  return (
    <div className="space-y-4" data-testid="project-status-card">
      {REPORT_FIELD_GROUPS.map((group) => {
        const fields = fieldsInGroup(group);
        return (
          <section key={group} className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-px-muted">{group}</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {fields.map((field) => {
                const raw = data[field.key];
                const absent = raw === null || raw === undefined || raw === "";
                const text = value(field.key, raw);
                const numeric = field.type !== "text";
                return (
                  // A figure is right-aligned with tabular numerals, and so is
                  // its label -- otherwise the pair reads as two columns rather
                  // than one, which is worse than either alignment alone.
                  <div key={field.key} className={numeric ? "text-right" : undefined}>
                    <div className="text-xs text-px-muted">{field.label}</div>
                    <div
                      className={`font-medium text-px-ink ${numeric ? MONEY_CELL_CLASS : ""}`}
                      // An en dash a reader can hover and be told what it means.
                      title={absent ? NOT_RECORDED_TITLE : undefined}
                      data-testid={`project-status-${field.key}`}
                    >
                      {text}
                    </div>
                    {/* R-138: the reason the two percentages disagree, under
                        them, replacing the code comment that acknowledged the
                        confusion without ever showing it to anyone. */}
                    {field.note && <div className="text-[11px] text-px-muted">{field.note}</div>}
                    {/* E-06 kept the ERP's annual ledger sum under its own name.
                        It rides as the Budget field's subtitle so it can never
                        be read as a second, disagreeing "Budget". */}
                    {field.key === "budget" && (
                      <div className="text-[11px] text-px-muted" data-testid="project-status-ledger-budget">
                        {financialsRedacted
                          ? "Needs manager role"
                          : `${LEDGER_BUDGET_LABEL} ${ledgerBudget === null || ledgerBudget === undefined ? EMPTY_VALUE : value("budget", ledgerBudget)}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="sr-only">{PERCENT_DIVERGENCE_NOTE}</p>
    </div>
  );
}
