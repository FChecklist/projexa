import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): the Documents list never had a
// detail route -- a file could be uploaded but never viewed/downloaded
// again. Proxies to VERIDIAN's new /v1/projexa/documents/[id] (root: true,
// same as the list route -- lives at /api/v1/documents, not
// /api/v1/projexa/documents).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/documents/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load document" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/documents/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update document" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
