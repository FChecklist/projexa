import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-36: one inbound receipt. GET backs the receipt object page; PATCH
// carries the SOFT void ({ action: "void", voidReason }) -- there is
// deliberately no DELETE, on either side of this proxy: a received-goods row
// that simply disappears is unauditable, so a void keeps the row, records who
// voided it and why, and drops it out of every total.
//
// The sibling ./master/[id] route is the material master; this dynamic
// segment is the receipt, and Next's own matching gives the static "master"
// segment precedence, so the two cannot collide. Same root:true path as the
// rest of the construction materials surface (see ../route.ts).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/materials/receipts/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      root: true,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load material receipt" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/materials/receipts/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "PATCH",
      body,
      root: true,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to void material receipt" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
