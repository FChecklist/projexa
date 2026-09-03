"use client";

// R67 E-22 (R-199 / R-207). The one renderer every named report goes
// through. It takes the pure model src/lib/report-documents.ts builds and
// draws it as a document: fixed columns, words left, figures right in
// tabular numerals, subtotal and total rows emphasised, a null cell reading
// "Not set" with the action beside it.
//
// D-09: this is a projexa-local component. The kit's ReportScreen supplies
// the chrome around it (header block, parameter bar, footer actions); the
// report's own table stays with the report, exactly as ReportScreen's own
// header comment says it should.

import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MONEY_CELL_CLASS } from "@/lib/format-money";
import { formatNumber } from "@/lib/format-number";
import { formatDate } from "@/lib/format-date";
import type { OrgMoney } from "@/lib/use-org-money";
import {
  NOT_SET,
  alignFor,
  type ReportCellValue,
  type ReportColumn,
  type ReportDocumentModel,
  type ReportSection,
} from "@/lib/report-documents";

function renderCell(value: ReportCellValue, column: ReportColumn, orgMoney: OrgMoney): string {
  if (value === null || value === undefined || value === "") return value === "" ? "" : NOT_SET;
  switch (column.unit) {
    case "currency":
      return orgMoney.money(value as number);
    case "percent":
      return `${formatNumber(Number(value), { fractionDigits: 0 })}%`;
    case "number":
      return formatNumber(Number(value), { fractionDigits: 0 });
    case "date":
      return formatDate(String(value));
    default:
      return String(value);
  }
}

function SectionTable({ section, orgMoney }: { section: ReportSection; orgMoney: OrgMoney }) {
  const dataRows = section.rows.filter((r) => (r.kind ?? "row") === "row");

  if (section.photos) {
    return section.photos.length === 0 ? (
      <p className="py-6 text-center text-sm text-px-muted">{section.emptyLabel}</p>
    ) : (
      <div className="space-y-4">
        {section.photos.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 text-xs font-medium text-px-muted">{formatDate(group.date)} · {group.items.length} photo{group.items.length === 1 ? "" : "s"}</p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {group.items.map((item) => (
                <li key={item.id} className="rounded-md border border-px-border p-2 text-xs text-px-ink">
                  <Link href={`/documents/${item.id}`} className="hover:underline">{item.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (section.rows.length === 0 || (dataRows.length === 0 && section.rows.length === 0)) {
    return <p className="py-6 text-center text-sm text-px-muted">{section.emptyLabel ?? "Nothing to report."}</p>;
  }

  return (
    // A report is often wider than the screen; it scrolls inside its own
    // container so the page body never scrolls sideways.
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {section.columns.map((column) => (
              <TableHead key={column.key} className={alignFor(column) === "right" ? "text-right" : undefined}>
                {column.label}
                {column.unit === "currency" ? orgMoney.unitSuffix : ""}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {section.rows.map((row) => {
            const kind = row.kind ?? "row";
            return (
              <TableRow key={row.key} className={kind === "row" ? undefined : "font-medium bg-muted/40"}>
                {section.columns.map((column, index) => {
                  const right = alignFor(column) === "right";
                  const text = renderCell(row.cells[column.key] ?? null, column, orgMoney);
                  return (
                    <TableCell key={column.key} className={right ? MONEY_CELL_CLASS : undefined}>
                      {index === 0 && row.href ? <Link href={row.href} className="hover:underline">{text}</Link> : text}
                      {index === 0 && row.hint && (
                        <span className="block text-[11px] text-px-muted">{row.hint}</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReportDocument({ model, orgMoney }: { model: ReportDocumentModel; orgMoney: OrgMoney }) {
  return (
    <div className="space-y-6">
      {model.sections.map((section) => (
        <section key={section.key} className="space-y-2">
          {section.title && <h3 className="text-[13px] font-medium text-px-ink">{section.title}</h3>}
          {section.note && <p className="text-[12px] text-px-muted">{section.note}</p>}
          <SectionTable section={section} orgMoney={orgMoney} />
        </section>
      ))}
    </div>
  );
}
