import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-30: the Daily Attendance Sheet saves the whole roster for one date in
// ONE call. VERIDIAN's /attendance/bulk runs the upsert inside a single
// transaction (see recordAttendanceBatch in construction-labour-service.ts) --
// the alternative, looping this proxy's own POST once per worker, would open
// one transaction per row on a five-connection pool.
//
// 200, not 201: re-saving a sheet corrects rows that already exist, so this is
// not always a creation.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/attendance/bulk", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to save the attendance sheet" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
