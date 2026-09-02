import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Priority 13: POST re-enabled now that VERIDIAN exposes
// /api/v1/projexa/fiscal-years and /api/v1/projexa/cost-centers -- a real
// fiscalYearId/costCenterId can be looked up from PROJEXA instead of the
// user having to guess an opaque VERIDIAN-side ID (the gap this route used
// to flag as GET-only).
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const qs = request.nextUrl.search;
  try {
    const data = await callVeridian(`/project-budgets${qs}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load budgets");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
  if (roleError) return roleError;
  const body = await request.json();
  try {
    const data = await callVeridian("/project-budgets", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create budget");
  }
});
