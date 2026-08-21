import { notFound } from "next/navigation";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";
import { buildWorkProgressReport, formatProgressCell, type BoqLineItem, type Activity, type Category, type ProgressEntry } from "@/lib/work-progress-report";

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
            <th style={{ padding: "0.5rem" }}>Prev %</th>
            <th style={{ padding: "0.5rem" }}>Current %</th>
            <th style={{ padding: "0.5rem" }}>Total %</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.lineItemId} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "0.5rem", paddingLeft: r.parentLineItemId ? "1.5rem" : "0.5rem" }}>{r.code} {r.description}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatProgressCell(r.percentage.prev, r.touched.prev)}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatProgressCell(r.percentage.current, r.touched.current)}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{formatProgressCell(r.percentage.total, r.touched.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
