import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/sales-orders/bulk-status", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to bulk-update sales order status");
  }
}
