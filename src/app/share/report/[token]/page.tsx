import { notFound } from "next/navigation";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";
import { buildWorkProgressReport, formatParentOnlyPercent, sumRootAmtTotal, type BoqLineItem, type Activity, type Category, type ProgressEntry } from "@/lib/work-progress-report";

// CONS-03's PDF fix and WorkProgressReportClient.tsx's own money() both
// format plain numbers, no currency code (the code/symbol is a per-org
// setting this unauthenticated, no-session page has no way to resolve) --
// matched here rather than inventing a third formatting rule.
function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Point 118: the PUBLIC, read-only view a share-link token resolves to.
// Deliberately outside src/app/(app)/ -- no sidebar, no nav, no app chrome,
// no session, no link back into the product (AR-10: render, never authorise).
// Fetches VERIDIAN's public /api/reports/share/[token] DIRECTLY with a plain
// unauthenticated fetch (never callVeridian/callVeridianRaw, which always
// resolve an API key first) -- the whole point of this page is that it
// needs no credentials of any kind, session or Bearer.
type SharedReport = {
  projectId: string; from: string; to: string; boqTitle: string | null;
  lineItems: BoqLineItem[]; activities: Activity[]; categories: Category[]; entries: ProgressEntry[];
};

async function fetchSharedReport(token: string): Promise<SharedReport | null> {
  const res = await fetch(`${VERIDIAN_ORIGIN}/api/reports/share/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await fetchSharedReport(token);
  if (!data) notFound();

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
