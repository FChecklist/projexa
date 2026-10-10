import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Sumeet requirement #3: invoicing a billing milestone needs a real
// taxTemplateId. GET lists them; POST (defect D1, 2026-10-10) creates one --
// a fresh org has none, so invoicing was impossible without this.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/tax-templates", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load tax templates");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
  if (roleError) return roleError;
  const body = await request.json();
  try {
    const data = await callVeridian("/tax-templates", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create tax template");
  }
});
