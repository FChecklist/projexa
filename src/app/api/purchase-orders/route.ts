import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Priority 17 Wave 1 (multi-currency Selling & Buying): thin proxy over
// VERIDIAN's new /api/v1/projexa/purchase-orders -- did not exist before
// this wave, PROJEXA had no way to raise a purchase order against a vendor
// at all (VendorsClient.tsx only ever managed vendor master data).
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const qs = request.nextUrl.search;
  try {
    const data = await callVeridian(`/purchase-orders${qs}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load purchase orders");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
  if (roleError) return roleError;
  const body = await request.json();
  try {
    const data = await callVeridian("/purchase-orders", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create purchase order");
  }
});
