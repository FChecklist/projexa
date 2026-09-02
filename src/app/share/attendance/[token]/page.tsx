import { notFound } from "next/navigation";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";
import { countCell, headlineSentence, tradeLabel, type AttendanceSummary } from "@/lib/attendance-summary";

// R67 D-31 (R-090): the PUBLIC, read-only view an attendance share token
// resolves to. Deliberately outside src/app/(app)/ -- no sidebar, no nav, no
// app chrome, no session, no link back into the product (AR-10: render, never
// authorise). Same shape and same rules as /share/report/[token], including the
// unauthenticated fetch: it calls VERIDIAN's public /api/reports/share/[token]
// with a plain fetch, never callVeridian/callVeridianRaw, which would resolve an
// API key first -- the whole point of this page is that it needs no credentials
// of any kind.
//
// Money is formatted without a currency code, matching the work-progress share
// page's own money(): the org's currency is a per-org setting a page with no
// session cannot resolve, and inventing one would be worse than omitting it.
function money(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchSharedSummary(token: string): Promise<AttendanceSummary | null> {
  const res = await fetch(`${VERIDIAN_ORIGIN}/api/reports/share/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  // The same token endpoint serves both shareable report types; a work-progress
  // token opened on this route is not this page's report and must not be
  // half-rendered as one.
  if (data?.reportType !== "attendance_summary") return null;
  return data as AttendanceSummary;
}

export default async function SharedAttendancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await fetchSharedSummary(token);
  if (!data) notFound();

  const cell = { padding: "0.5rem", textAlign: "right" as const };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "sans-serif" }}>
      <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.25rem" }}>Shared, read-only — expires automatically</p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Attendance Summary</h1>
      <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
        {data.from && data.to ? (data.from === data.to ? data.from : `${data.from} to ${data.to}`) : "All recorded attendance"}
      </p>

      {/* Never print a total the two source aggregates disagree about without
          saying so -- the same rule the authenticated panel and the PDF apply. */}
      {data.reconciliation?.ties === false && (
        <p style={{ fontSize: "0.8125rem", color: "#b03a3a", marginBottom: "1rem" }}>
          The per-trade rows do not add up to the totals for this window — treat these figures as provisional.
        </p>
      )}

      <p style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
        {headlineSentence(data.headcount, data.rows)}
      </p>

      {data.rows.length === 0 ? (
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
              <th style={cell}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.trade} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>{tradeLabel(row.trade)}</td>
                <td style={cell}>{countCell(row.present)}</td>
                <td style={cell}>{countCell(row.halfDay)}</td>
                <td style={cell}>{countCell(row.absent)}</td>
                <td style={cell}>{countCell(row.workerDays)}</td>
                <td style={cell}>{money(row.cost)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #ddd", fontWeight: 600 }}>
              <td style={{ padding: "0.5rem" }}>Total</td>
              <td style={cell}>{countCell(data.totals.present)}</td>
              <td style={cell}>{countCell(data.totals.halfDay)}</td>
              <td style={cell}>{countCell(data.totals.absent)}</td>
              <td style={cell}>{countCell(data.totals.workerDays)}</td>
              <td style={cell}>{money(data.totals.cost)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </main>
  );
}
