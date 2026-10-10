import { NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Defect D1 (2026-10-10): the tax accounts (CGST/SGST/IGST) the "Create tax
// template" form picks from. GET lists them; POST sets up the three standard
// GST accounts when the organisation has none (idempotent on the backend).
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/tax-templates/accounts", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load tax accounts");
  }
});

export const POST = withTiming("POST", async function POST() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
  if (roleError) return roleError;
  try {
    const data = await callVeridian("/tax-templates/accounts", { organizationId: ctx.organizationId!, method: "POST", body: {} });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to set up tax accounts");
  }
});
