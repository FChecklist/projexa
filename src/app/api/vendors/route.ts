import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/vendors", { organizationId: ctx.organizationId! });
    // R67 F-25 (R-241): the vendor list is a slowly-changing, session-scoped
    // lookup that three screens ask for (/labour, /labour/new,
    // /labour/attendance/new). Ten minutes in the browser's own cache, and
    // PRIVATE -- the rows are resolved with the caller's own org key, so a
    // shared cache must never hold them.
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load vendors");
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/vendors", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create vendor");
  }
}
