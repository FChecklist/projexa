import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  // R67 F-25 (R-241): attendance is a DATED question. This proxy used to
  // forward projectId alone, so the Manpower screen pulled a project's whole
  // attendance log on every landing for a tab it opens closed. ?date= asks for
  // one day; ?from=/?to= for an inclusive range. Each is validated as a plain
  // ISO date here rather than concatenated blind into the upstream URL.
  const params = new URLSearchParams({ projectId });
  for (const key of ["date", "from", "to"] as const) {
    const value = request.nextUrl.searchParams.get(key);
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) params.set(key, value);
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
