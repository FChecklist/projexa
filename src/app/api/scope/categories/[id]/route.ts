import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 lane I (WS-I item I-05, R-177): rename or retire one BOQ category.
//
// Both are thin relays. In particular the DELETE refusal ("Used by 12 BOQ
// lines", HTTP 409) is produced by VERIDIAN and passed through UNCHANGED --
// re-deriving that count here would mean a second source of truth for whether
// a category is in use, and the two would eventually disagree.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  try {
    const data = await callVeridian(`/scope/categories/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "PATCH",
      body,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to rename BOQ category" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/categories/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "DELETE",
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to delete BOQ category" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
