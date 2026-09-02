import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-30/D-33: this proxy used to forward ONLY projectId, so the whole
// project's attendance ledger came back on every call and any narrowing (one
// date for the daily sheet, one worker for the object page's history, a month
// window for the summary) had to happen in the browser. VERIDIAN's
// listAttendance() filters all four server-side; the query is now forwarded
// intact. rosterId alone is a legitimate query (a worker's history is not
// scoped to one project), which is why projectId is no longer unconditionally
// required -- but one of the two still is, or the request would ask for the
// org's entire ledger.
const FORWARDED_PARAMS = ["projectId", "rosterId", "attendanceDate", "from", "to"] as const;

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const search = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) search.set(key, value);
  }
  if (!search.has("projectId") && !search.has("rosterId")) {
    return NextResponse.json({ error: "projectId or rosterId query param is required" }, { status: 400 });
  }

  try {
    const data = await callVeridian(`/attendance?${search.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load attendance" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/attendance", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to record attendance" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
