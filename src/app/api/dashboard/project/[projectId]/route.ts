import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R42 seq24 (DASHBOARD.PROJECT): thin proxy to VERIDIAN's existing
// /api/v1/projexa/dashboard/[projectId] -- the getProjectDashboard() data
// layer already existed (Wave 121); this seq only added earnedValue/
// percentByValue/contractValue to it (D-3, reusing earnedValueReport). No
// projexa consumer of this endpoint existed before this seq.
export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { projectId } = await params;
  try {
    const data = await callVeridian(`/dashboard/${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load project dashboard");
  }
});
