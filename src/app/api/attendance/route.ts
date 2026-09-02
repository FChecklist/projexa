import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  // R67 F-06 (R-088/R-094): the attendance log grows as workers x days, and
  // /labour used to ask for the whole history of the project on every page
  // load. `from`/`to` are forwarded to VERIDIAN's listAttendance, which gained
  // the matching range filter in the same change. Both are optional here so
  // every other caller of this proxy keeps its previous behaviour.
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const query = new URLSearchParams({ projectId });
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  try {
    const data = await callVeridian(`/attendance?${query.toString()}`, { organizationId: ctx.organizationId! });
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
