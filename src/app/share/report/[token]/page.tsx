import { notFound } from "next/navigation";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";
import { buildWorkProgressReport, formatParentOnlyPercent, sumRootAmtTotal, type BoqLineItem, type Activity, type Category, type ProgressEntry } from "@/lib/work-progress-report";
import { formatMoney } from "@/lib/format-money";
import { formatNumber } from "@/lib/format-number";

// CONS-03's PDF fix and WorkProgressReportClient.tsx's own money() both
// format plain numbers, no currency code (the code/symbol is a per-org
// setting this unauthenticated, no-session page has no way to resolve) --
// matched here rather than inventing a third formatting rule.
//
// R67 D-61: that intent is now enforced rather than restated. This page is a
// Server Component, which is precisely why format-money.ts carries no
// "use client" -- the same helper the in-app report uses formats this public
// copy, so a client cannot be shown a share link whose numbers are grouped
// differently from the screen it was shared from. `currency` is deliberately
// left unset: this page has no session and therefore no org, and the rule is
// that a currency is never guessed.
function money(n: number) {
  return formatMoney(n, {});
}

// Point 118: the PUBLIC, read-only view a share-link token resolves to.
// Deliberately outside src/app/(app)/ -- no sidebar, no nav, no app chrome,
// no session, no link back into the product (AR-10: render, never authorise).
// Fetches VERIDIAN's public /api/reports/share/[token] DIRECTLY with a plain
// unauthenticated fetch (never callVeridian/callVeridianRaw, which always
// resolve an API key first) -- the whole point of this page is that it
// needs no credentials of any kind, session or Bearer.
type SharedWorkProgressReport = {
  reportType?: "work_progress";
  projectId: string; from: string; to: string; boqTitle: string | null;
  lineItems: BoqLineItem[]; activities: Activity[]; categories: Category[]; entries: ProgressEntry[];
};

// R67 E-12 (R-136): the second report that can be shared publicly. Item E-09
// had to leave Share on the Reports screen copying an in-app URL because this
// page rendered the Work Progress Report specifically -- a token for any other
// report would have resolved to a page that could not draw it. The share
// service gained the type and this page gained the renderer in the same change,
// never one without the other.
type SharedProjectStatusLine = {
  lineItemId: string; category: string | null; code: string | null; description: string;
  budget: number | null; vendorName: string | null; vendorAmount: number | null;
};
type SharedProjectStatusReport = {
  reportType: "project_status";
  projectId: string; from: string; to: string; boqTitle: string | null;
  dashboard: {
    projectName: string; contractValue: number | null; projectValue: number | null; budget: number | null;
    revenue: number; expenses: number; earnedValue: number | null;
    percentByValue: number | null; progressPercent: number;
  };
  lines: SharedProjectStatusLine[];
  totals: { budget: number | null; vendorAmount: number };
};

type SharedReport = SharedWorkProgressReport | SharedProjectStatusReport;

async function fetchSharedReport(token: string): Promise<SharedReport | null> {
  const res = await fetch(`${VERIDIAN_ORIGIN}/api/reports/share/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

/** The en dash. On a public page as everywhere else, absent is not zero. */
const EMPTY = "–";

function figure(n: number | null | undefined) {
  return n === null || n === undefined ? EMPTY : money(n);
}

function SharedProjectStatus({ data }: { data: SharedProjectStatusReport }) {
  const d = data.dashboard;
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "sans-serif" }}>
      <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.25rem" }}>Shared, read-only — expires automatically</p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{d.projectName}</h1>
      <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1.5rem" }}>
        Project Status{data.boqTitle ? ` · BOQ ${data.boqTitle}` : ""}
      </p>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        {([
          ["Contract Value", figure(d.contractValue)],
          ["Project Value", figure(d.projectValue)],
          ["Budget", figure(d.budget)],
          ["Revenue", figure(d.revenue)],
          ["Expenses", figure(d.expenses)],
          ["Earned Value", figure(d.earnedValue)],
          // R67 D-61 (second-merge fix): formatNumber(), not a direct
          // toFixed() -- money-format-rule.test.ts bans the method itself
          // anywhere under src/app, not only where a locale mismatch is
          // visible today.
          ["% complete (by BOQ value)", d.percentByValue === null ? EMPTY : `${formatNumber(d.percentByValue, { fractionDigits: 1 })}%`],
          ["% complete (by activity log)", `${formatNumber(d.progressPercent, { fractionDigits: 1 })}%`],
        ] as const).map(([label, value]) => (
          <div key={label}>
            <dt style={{ fontSize: "0.75rem", color: "#888" }}>{label}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
          </div>
        ))}
      </dl>

      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Subcontractor / Budget breakup</h2>
      {data.lines.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#666" }}>No budget lines recorded for this project.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd" }}>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Category</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Code</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Description</th>
              <th style={{ textAlign: "right", padding: "0.5rem" }}>Budget</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Vendor</th>
              <th style={{ textAlign: "right", padding: "0.5rem" }}>Vendor amount</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.lineItemId} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>{l.category ?? EMPTY}</td>
                <td style={{ padding: "0.5rem" }}>{l.code ?? EMPTY}</td>
                <td style={{ padding: "0.5rem" }}>{l.description}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{figure(l.budget)}</td>
                <td style={{ padding: "0.5rem" }}>{l.vendorName ?? EMPTY}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{figure(l.vendorAmount)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #ddd", fontWeight: 600 }}>
              <td style={{ padding: "0.5rem" }}>Grand Total</td>
              <td /><td />
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{figure(data.totals.budget)}</td>
              <td />
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{figure(data.totals.vendorAmount)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </main>
  );
}

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await fetchSharedReport(token);
  if (!data) notFound();

  if (data.reportType === "project_status") return <SharedProjectStatus data={data} />;

  const report = buildWorkProgressReport({
    lineItems: data.lineItems, entries: data.entries, activities: data.activities, categories: data.categories,
    from: data.from, to: data.to,
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "sans-serif" }}>
      <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.25rem" }}>Shared, read-only — expires automatically</p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{data.boqTitle ?? "Work Progress Report"}</h1>
      <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1.5rem" }}>{data.from} to {data.to}</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "right" }}>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Item</th>
            {/* CONS-04: Rate + Amt (Contract Value) -- present on the
                Dashboard and the live Report tab, and (as of CONS-03) the
                PDF export, but previously absent here entirely. */}
            <th style={{ padding: "0.5rem" }}>Rate</th>
            <th style={{ padding: "0.5rem" }}>Amt</th>
            <th style={{ padding: "0.5rem" }}>Prev %</th>
            <th style={{ padding: "0.5rem" }}>Current %</th>
            <th style={{ padding: "0.5rem" }}>Total %</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => {
            const isChild = !!r.parentLineItemId; // WPR-06: percent cells are parent rows only
            return (
              <tr key={r.lineItemId} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem", paddingLeft: isChild ? "1.5rem" : "0.5rem" }}>{r.code} {r.description}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{money(r.rate)}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{money(r.amtTotal)}</td>
                {/* CONS-05: matches the live Report tab's ScopeTable exactly
                    -- a parent always renders a real number (0% included),
                    only a child ever blanks. touched is not consulted here
                    (that was the bug: an untouched PARENT used to blank
                    like a child instead of showing "0%"). */}
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatParentOnlyPercent(r.percentage.prev, isChild)}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatParentOnlyPercent(r.percentage.current, isChild)}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatParentOnlyPercent(r.percentage.total, isChild)}</td>
              </tr>
            );
          })}
          {/* CONS-04: Grand Total row, root/parent BOQ lines only (D-3) --
              same rule as WorkProgressReportClient.tsx's computeGrandTotal()
              and the CONS-03 PDF fix, factored into sumRootAmtTotal() so
              all three stay in agreement. */}
          <tr style={{ borderTop: "2px solid #ddd", fontWeight: 600 }}>
            <td style={{ padding: "0.5rem" }}>Grand Total</td>
            <td style={{ padding: "0.5rem" }} />
            <td style={{ padding: "0.5rem", textAlign: "right" }}>{money(sumRootAmtTotal(report.rows))}</td>
            <td style={{ padding: "0.5rem" }} />
            <td style={{ padding: "0.5rem" }} />
            <td style={{ padding: "0.5rem" }} />
          </tr>
        </tbody>
      </table>
    </main>
  );
}
