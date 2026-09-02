import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): the Documents list never had a
// detail route -- a file could be uploaded but never viewed/downloaded
// again. Proxies to VERIDIAN's /v1/projexa/documents/[id].
//
// R67 D-15. This route passed `root: true`, which resolves to
// {VERIDIAN_API_ROOT}/documents/{id} -- i.e. /api/v1/documents/{id}, a route
// that does not exist in compliance-tracker. Only the LIST and the CREATE live
// at /api/v1/documents (hence `root: true` on documents/route.ts, which is
// correct); the single-document route was added under /api/v1/projexa/documents/
// [id], which is where its own sibling proxy (documents/[id]/dispose) has always
// pointed. So every GET from the document object page reached a 404 and the page
// could only ever show its own load error. Dropping `root` is the whole fix.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/documents/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
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
    // R67 D-15: `name` goes through too -- a typo made at upload time was
    // unfixable, and a document named "scan_0012.pdf" is unfindable.
    const data = await callVeridian(`/documents/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update document" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
