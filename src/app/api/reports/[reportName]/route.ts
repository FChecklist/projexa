import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { reportName } = await params;
  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  const query = new URLSearchParams({ projectId });
  const weekStart = searchParams.get("weekStart");
  if (weekStart) query.set("weekStart", weekStart);

  try {
    const data = await callVeridian(`/reports/${encodeURIComponent(reportName)}?${query.toString()}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : `Failed to generate ${reportName} report` }, { status: 502 });
  }
}
