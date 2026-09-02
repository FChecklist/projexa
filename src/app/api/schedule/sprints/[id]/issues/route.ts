import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

// Priority 17 Wave 1: proxies to VERIDIAN
// /api/v1/projexa/schedule/sprints/[id]/issues.
export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/schedule/sprints/${encodeURIComponent(id)}/issues`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load sprint issues");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  if (!body.issueId) return NextResponse.json({ error: "issueId is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/schedule/sprints/${encodeURIComponent(id)}/issues`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to add issue to sprint");
  }
});

export const DELETE = withTiming("DELETE", async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const issueId = request.nextUrl.searchParams.get("issueId");
  if (!issueId) return NextResponse.json({ error: "issueId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/schedule/sprints/${encodeURIComponent(id)}/issues?issueId=${encodeURIComponent(issueId)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to remove issue from sprint");
  }
});
