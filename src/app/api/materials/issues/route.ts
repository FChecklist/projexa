import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-40: material ISSUES -- what left the store. The module tracked what
// arrived and never what was consumed, so the master could not carry a
// quantity at all, which is Sumeet's item 8 ("material database. material
// inbound, spec, cost, qty") half-answered.
//
// Lives at VERIDIAN's /api/v1/construction/materials/issues -- root:true, the
// same path shape as the sibling receipts proxy (see ../route.ts). The static
// "issues" segment takes precedence over the sibling [id] receipt route, the
// same way "master" already does.
//
// The on-hand cap is enforced on the VERIDIAN side, not here: two storekeepers
// on two phones would otherwise both pass a client-side check. Its refusal
// ("Only 120 bag on hand") is a 400 and reaches the form verbatim.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/materials/issues?projectId=${encodeURIComponent(projectId)}`, {
      organizationId: ctx.organizationId!,
      root: true,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load material issues" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/materials/issues", {
      organizationId: ctx.organizationId!,
      method: "POST",
      body,
      root: true,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to record material issue" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
