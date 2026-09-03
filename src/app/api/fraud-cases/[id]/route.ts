import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Priority 15: VERIDIAN's /api/v1/projexa/fraud-cases/[id] -- case detail
// and status transitions.
//
// Real-screen conversion (2026-08-30): GET was already real on the
// VERIDIAN side (getFraudCase()) but this proxy never exposed it -- the
// case list had no detail view, so description/detectionSource/
// financialExposure/investigatorId were write-only from the create dialog,
// never shown again.
export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/fraud-cases/${id}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load fraud case");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/fraud-cases/${id}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update fraud case");
  }
});
