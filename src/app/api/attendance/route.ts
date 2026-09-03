import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 F-25 (R-241) + D-30/D-33, reconciled. Attendance is a DATED question and
// also a question ABOUT SOMEONE, and this proxy used to forward projectId
// alone -- so the Manpower screen pulled a project's whole attendance log on
// every landing, for a tab it opens closed, and any narrowing had to happen in
// the browser. VERIDIAN's listAttendance() filters all of it server-side.
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
    // R67 FIX PASS (C-08) -- THE CODE HAS TO SURVIVE BOTH HOPS.
    //
    // C-08's whole "Attendance for today is already saved - replace it?" path
    // hangs off the shell branching on `d?.code === "REPLACE_REQUIRED"`, and
    // the compliance-tracker route was changed specifically to put that code
    // in the 409 body. It was then destroyed twice on the way back: once in
    // veridian-client (VeridianApiError had no field for a BUSINESS-RULE code
    // at all) and once here, where the catch re-serialised only `{ error }`.
    // So the normal case -- a foreman re-marking a crew he already marked
    // this morning -- showed the raw sentence with no Replace control and no
    // way forward: exactly the dead end this programme removes.
    //
    // R67 MERGE (D-11): veridian-client's field for this is now `ruleCode`
    // (see its own "lane B x lane F2" merge note) -- `code` there is the
    // TRANSPORT classification (null for a 4xx), which is why
    // veridianErrorResponse()'s default `code` would be null for this exact
    // failure. `extra` overrides it with the real rule code when there is
    // one, so both hops still carry it and every OTHER failure still gets
    // veridianErrorResponse()'s own retry/Server-Timing handling unchanged.
    const extra = err instanceof VeridianApiError && err.ruleCode ? { code: err.ruleCode } : undefined;
    return veridianErrorResponse(err, "Failed to record attendance", undefined, extra);
  }
});
