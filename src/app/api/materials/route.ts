import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Point 33: repointed from the old ERP inventory read (which had no create
// path -- a receipt form against it would have been guesswork warehouseId/
// itemId) to the new construction material-receipts backend, which has a
// real master (see materials/master/route.ts) to select against. Lives at
// VERIDIAN's /api/v1/construction/materials/receipts -- root:true, same
// reasoning as materials/master and labour-roster.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/materials/receipts?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load materials" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/materials/receipts", { organizationId: ctx.organizationId!, method: "POST", body, root: true });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to record material receipt" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
