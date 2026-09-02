import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withTiming("POST", async function POST(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/payroll/payslips/${encodeURIComponent(id)}/finalize`, { organizationId: ctx.organizationId!, method: "POST" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to finalize payslip");
  }
});
