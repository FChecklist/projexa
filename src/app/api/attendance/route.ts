import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 D-30/D-33 + F-25 (R-241), reconciled: this proxy used to forward ONLY
// projectId, so the whole project's attendance ledger came back on every call
// and any narrowing -- one date for the daily sheet, one worker for the object
// page's history, a month window for the summary -- had to happen in the
// browser. VERIDIAN's listAttendance() filters all of them server-side.
//
// Two lanes narrowed it from different ends and BOTH are kept:
//   * F-25's dated question: ?date= for one day, ?from=/?to= for an inclusive
//     range, each validated as a plain ISO date here rather than concatenated
//     blind into the upstream URL.
//   * D-30/D-33's subject: ?rosterId= for one worker, and ?attendanceDate= --
//     the name the daily sheet's own POST body uses, kept so the sheet reads
//     back exactly what it wrote.
//
// rosterId ALONE is a legitimate query: a worker's history is not scoped to one
// project, which is why projectId is no longer unconditionally required. One of
// the two still is, or the request would ask for the org's entire ledger.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SUBJECT_PARAMS = ["projectId", "rosterId"] as const;
const DATE_PARAMS = ["attendanceDate", "date", "from", "to"] as const;

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const params = new URLSearchParams();
  for (const key of SUBJECT_PARAMS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) params.set(key, value);
  }
  if (!params.has("projectId") && !params.has("rosterId")) {
    return NextResponse.json({ error: "projectId or rosterId query param is required" }, { status: 400 });
  }
  for (const key of DATE_PARAMS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value && ISO_DATE.test(value)) params.set(key, value);
  }

  try {
    const data = await callVeridian(`/attendance?${params.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load attendance");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/attendance", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to record attendance");
  }
});
