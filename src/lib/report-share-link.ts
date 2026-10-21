// R-C15: one place that mints a PUBLIC share link for a report (POST /api/reports/<report>/share, the same route the online Reports screen uses). The route
// needs a project and a date range; only the reports in SHAREABLE_REPORTS have a public page, and any other is refused here in words before a request is made.
import { SHAREABLE_REPORTS } from "@/lib/report-document-actions";

export const isShareableReport = (report: string): boolean => (SHAREABLE_REPORTS as readonly string[]).includes(report);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The range a link is minted for: the one in the report's own address when it has one, otherwise the last 30 days up to today. */
export function shareRangeFor(reportUrl: string, now: Date = new Date()): { from: string; to: string } {
  const q = new URLSearchParams(reportUrl.includes("?") ? reportUrl.slice(reportUrl.indexOf("?") + 1) : "");
  const from = q.get("from");
  const to = q.get("to");
  if (from && to) return { from, to };
  const start = new Date(now.getTime() - 29 * 86_400_000);
  return { from: from ?? isoDay(start), to: to ?? isoDay(now) };
}

export async function createReportShareLink(input: { report: string; projectId: string; reportUrl: string; fetchImpl?: typeof fetch; now?: Date }): Promise<{ url: string; expiresAt: string | null }> {
  if (!isShareableReport(input.report)) throw new Error("This report has no public view yet, so it cannot be shared as a link. Copy the text for WhatsApp instead.");
  const { from, to } = shareRangeFor(input.reportUrl, input.now);
  const path = `/api/reports/${encodeURIComponent(input.report)}/share`;
  const res = await (input.fetchImpl ?? fetch)(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: input.projectId, from, to }) });
  const data = (await res.json().catch(() => ({}))) as { url?: unknown; expiresAt?: unknown; error?: unknown };
  if (!res.ok || typeof data.url !== "string" || !data.url) {
    throw new Error(typeof data.error === "string" && data.error ? data.error : `The server answered ${res.status} and made no link.`);
  }
  return { url: data.url, expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null };
}
