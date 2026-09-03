import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/attendance?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
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
    // R67 FIX PASS (C-08) -- THE CODE HAS TO SURVIVE BOTH HOPS.
    //
    // C-08's whole "Attendance for today is already saved - replace it?" path
    // hangs off the shell branching on `d?.code === "REPLACE_REQUIRED"`, and
    // the compliance-tracker route was changed specifically to put that code
    // in the 409 body. It was then destroyed twice on the way back: once in
    // veridian-client (VeridianApiError had no `code` field at all) and once
    // here, where the catch re-serialised only `{ error }`. So the normal case
    // -- a foreman re-marking a crew he already marked this morning -- showed
    // the raw sentence with no Replace control and no way forward: exactly the
    // dead end this programme removes. Both hops now carry it.
    if (err instanceof VeridianApiError) {
      return NextResponse.json(
        err.code ? { error: err.message, code: err.code } : { error: err.message },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "Failed to record attendance" }, { status: 502 });
  }
}
