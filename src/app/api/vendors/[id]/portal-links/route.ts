import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Real-screen conversion (2026-08-30): the Vendor Object Page's Portal
// Links facet -- same "built with zero consumers" gap as
// bank-accounts/route.ts. Revoke lives at [linkId]/route.ts.
export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}/portal-links`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load portal links");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json().catch(() => ({}));
  try {
    const { id } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}/portal-links`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create portal link");
  }
});
