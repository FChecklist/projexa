import { NextRequest, NextResponse } from "next/server";
import { withTiming } from "@/lib/with-timing";

// Audit 37 point 33: any laptop reports (signed in or not: a login or signup failure is exactly what we need to hear about) errors it caught (src/lib/local-first/client-error-report.ts). Stores nothing; each report is
// one greppable error-level line in this site's runtime log: `[client-error] {...}`. No auth by design (owner: works-for-user first); size-capped, data-free.

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 16_384) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let reports: unknown;
  try { reports = (JSON.parse(raw) as { reports?: unknown }).reports; } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  if (!Array.isArray(reports)) return NextResponse.json({ error: "reports must be an array" }, { status: 400 });

  for (const r of reports.slice(0, 20)) {
    if (r === null || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
    console.error(`[client-error] ${JSON.stringify({ kind: s(o.kind, 40), message: s(o.message, 300), where: s(o.where, 120), at: s(o.at, 40) })}`);
  }
  return new NextResponse(null, { status: 204 });
});
