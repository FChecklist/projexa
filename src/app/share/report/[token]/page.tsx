import { ExpiredShareNotice } from "@/components/ExpiredShareNotice";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";
import { SharedReportUnavailable } from "@/components/SharedReportUnavailable";
import { loadSharedReport, type SharedProjectStatus } from "@/lib/shared-report";
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
// Project Status (R67 E-12 / R-136). The public copy is schedule, progress and
// scope ONLY -- owner ruling D91: an unauthenticated token never carries cost.
// VERIDIAN redacts at the source; this page does not render a money figure for
// it at all, and it reads the payload through interpretSharedReport() so a
// shape it did not expect is a guided notice, never a 500 (live bug 2026-10-22:
// `data.totals.budget` threw once `totals` was redacted away).

/** The en dash. On a public page as everywhere else, absent is not zero. */
const EMPTY = "–";

function pct(n: number | null) {
  return n === null ? EMPTY : `${formatNumber(n, { fractionDigits: 1 })}%`;
}
function count(n: number | null) {
  return n === null ? EMPTY : formatNumber(n, { fractionDigits: 0 });
}

const MAIN: React.CSSProperties = { maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "sans-serif" };

function SharedProjectStatusView({ data }: { data: SharedProjectStatus }) {
  return (
    <main style={MAIN}>
      <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.25rem" }}>Shared, read-only {"—"} expires automatically</p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{data.projectName}</h1>
      <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1.5rem" }}>
        Project Status{data.boqTitle ? ` · BOQ ${data.boqTitle}` : ""}
        {data.from && data.to ? ` · ${data.from} to ${data.to}` : ""}
      </p>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        {([
          ["% complete (by activity log)", pct(data.progressPercent)],
          ["Tasks", count(data.taskCount)],
          ["Delayed tasks", count(data.delayedTaskCount)],
          ["Photos", count(data.photoCount)],
        ] as const).map(([label, value]) => (
          <div key={label}>
            <dt style={{ fontSize: "0.75rem", color: "#888" }}>{label}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
          </div>
        ))}
      </dl>

      {data.categories.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Progress by category</h2>
          <ul style={{ fontSize: "0.875rem", marginBottom: "2rem", paddingLeft: "1.25rem" }}>
            {data.categories.map((c, i) => <li key={`${c.name}-${i}`}>{c.name}: {pct(c.percentComplete)}</li>)}
          </ul>
        </>
      )}

      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Scope</h2>
      {data.lines.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#666" }}>No scope lines recorded for this project.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd" }}>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Category</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Code</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Description</th>
              <th style={{ textAlign: "right", padding: "0.5rem" }}>Quantity</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.key} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>{l.category ?? EMPTY}</td>
                <td style={{ padding: "0.5rem" }}>{l.code ?? EMPTY}</td>
                <td style={{ padding: "0.5rem" }}>{l.description}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{l.quantity === null ? EMPTY : formatNumber(l.quantity, { fractionDigits: 2 })}</td>
                <td style={{ padding: "0.5rem" }}>{l.unit ?? EMPTY}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verdict = await loadSharedReport(VERIDIAN_ORIGIN, token);

  if (verdict.kind === "unavailable") {
    if (verdict.reason === "expired") return <main><ExpiredShareNotice kind="report" token={token} /></main>;
    return <main><SharedReportUnavailable reason={verdict.reason} /></main>;
  }
  if (verdict.kind === "attendance_summary") {
    return <main><SharedReportUnavailable reason="wrong-page" openHref={`/share/attendance/${encodeURIComponent(token)}`} openLabel="Open the shared attendance summary" /></main>;
  }
  if (verdict.kind === "project_status") return <SharedProjectStatusView data={verdict} />;

  const data = verdict.data;
  let report: ReturnType<typeof buildWorkProgressReport>;
  try {
    report = buildWorkProgressReport({
      lineItems: data.lineItems as BoqLineItem[], entries: data.entries as ProgressEntry[],
      activities: data.activities as Activity[], categories: data.categories as Category[],
      from: data.from, to: data.to,
    });
  } catch {
    return <main><SharedReportUnavailable reason="unreadable" /></main>;
  }

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
