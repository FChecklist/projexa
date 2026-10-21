import { ExpiredShareNotice } from "@/components/ExpiredShareNotice";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";
import { SharedReportUnavailable } from "@/components/SharedReportUnavailable";
import { countCell, headlineSentence, tradeLabel } from "@/lib/attendance-summary";
import { loadSharedReport } from "@/lib/shared-report";

// R67 D-31 (R-090): the PUBLIC, read-only view an attendance share token
// resolves to. Deliberately outside src/app/(app)/ -- no sidebar, no nav, no
// app chrome, no session, no link back into the product (AR-10: render, never
// authorise). Same shape and same rules as /share/report/[token], including the
// unauthenticated fetch: it calls VERIDIAN's public /api/reports/share/[token]
// with a plain fetch, never callVeridian/callVeridianRaw, which would resolve an
// API key first -- the whole point of this page is that it needs no credentials
// of any kind.
//
// Public copy carries NO cost (owner ruling D91: an unauthenticated token never
// carries cost) -- VERIDIAN strips the Cost column at the source, so this page
// has no Cost column and no money formatter. It reads the payload through
// loadSharedReport(), so a missing field or a different report type is a guided
// notice, never a 500 (same class as the /share/report live bug, 2026-10-22).

export default async function SharedAttendancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verdict = await loadSharedReport(VERIDIAN_ORIGIN, token);
  if (verdict.kind === "unavailable") {
    if (verdict.reason === "expired") return <main><ExpiredShareNotice kind="attendance" token={token} /></main>;
    return <main><SharedReportUnavailable reason={verdict.reason} /></main>;
  }
  if (verdict.kind !== "attendance_summary") {
    return <main><SharedReportUnavailable reason="wrong-page" openHref={`/share/report/${encodeURIComponent(token)}`} openLabel="Open the shared report" /></main>;
  }
  const data = verdict;
  const rows = data.rows.map((r) => ({ trade: r.trade, present: r.present ?? 0, halfDay: r.halfDay ?? 0, absent: r.absent ?? 0, workerDays: r.workerDays ?? 0, cost: 0 }));
  const headcount = data.headcount ?? rows.reduce((n, r) => n + r.present + r.halfDay, 0);

  const cell = { padding: "0.5rem", textAlign: "right" as const };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "sans-serif" }}>
      <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.25rem" }}>Shared, read-only {"—"} expires automatically</p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Attendance Summary</h1>
      <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
        {data.from && data.to ? (data.from === data.to ? data.from : `${data.from} to ${data.to}`) : "All recorded attendance"}
      </p>

      {/* Never print a total the two source aggregates disagree about without
          saying so -- the same rule the authenticated panel and the PDF apply. */}
      {data.ties === false && (
        <p style={{ fontSize: "0.8125rem", color: "#b03a3a", marginBottom: "1rem" }}>
          The per-trade rows do not add up to the totals for this window {"—"} treat these figures as provisional.
        </p>
      )}

      <p style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>{headlineSentence(headcount, rows)}</p>

      {rows.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#666" }}>No attendance was recorded in this window.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd" }}>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Trade</th>
              <th style={cell}>Present</th>
              <th style={cell}>Half day</th>
              <th style={cell}>Absent</th>
              <th style={cell}>Worker-days</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={`${row.trade}-${i}`} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>{tradeLabel(row.trade)}</td>
                <td style={cell}>{countCell(row.present)}</td>
                <td style={cell}>{countCell(row.halfDay)}</td>
                <td style={cell}>{countCell(row.absent)}</td>
                <td style={cell}>{countCell(row.workerDays)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #ddd", fontWeight: 600 }}>
              <td style={{ padding: "0.5rem" }}>Total</td>
              <td style={cell}>{countCell(data.totals.present)}</td>
              <td style={cell}>{countCell(data.totals.halfDay)}</td>
              <td style={cell}>{countCell(data.totals.absent)}</td>
              <td style={cell}>{countCell(data.totals.workerDays)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </main>
  );
}
